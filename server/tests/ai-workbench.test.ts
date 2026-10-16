import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { closeHistory, history, undo, redo } from '@tiptap/pm/history'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { AiContext, validateContext } from '../src/modules/ai/context.js'
import { generationParameters, loadAiModels, publicModel, type AiModel } from '../src/modules/ai/models.js'
import { AiBudget, loadAiPolicy, estimateRequest } from '../src/modules/ai/budget.js'
import { OpenAiProvider } from '../src/modules/ai/provider.js'
import { defaultGeneration, type AiInput, type ContextSelection } from '../../shared/contracts/ai.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { captureAiSnapshot, aiTransaction } from '../../src/features/ai/editor.js'
import { compareText } from '../../src/features/ai/comparison.js'

const model: AiModel = { id: 'mock', provider: 'compatible', label: '虚构模型', model: 'mock-model', apiKey: 'server-only-mock-key', baseUrl: 'https://example.invalid/v1', timeoutMs: 1000, maxOutputTokens: 1024, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
const input: AiInput = { action: 'continue', chapterId: '', before: '前文', selection: '', after: '', instructions: '', includeStoryContext: false }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-workbench-')), db = openDatabase(dir)
  const novels = new NovelStore(db), bible = new StoryBibleStore(db), planning = new PlanningStore(db)
  const novel = novels.create('虚构工作台', ''), other = novels.create('其他作品', '')
  const chapter = novels.createChapter(novel.id, novel.version, '当前章节').chapter
  const previous = novels.createChapter(novel.id, novels.novel(novel.id).version, '前一章').chapter
  novels.saveChapter(previous.id, previous.version, previous.title, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '只在引用后发送的已有章节。'.repeat(500) }] }] })
  const person = bible.saveCharacter(novel.id, { ...newCharacter(), name: '星河', fields: { ...newCharacter().fields, personality: '克制而勇敢' } })
  const world = bible.saveWorld(novel.id, { ...newWorld(), name: '云城', description: '😀'.repeat(2000) })
  const foreign = bible.saveWorld(other.id, { ...newWorld(), name: '不可引用的其他世界', description: '不发送' })
  const data = emptyPlanning()
  data.outlines.push({ id: 'outline', kind: 'overall', parentId: null, chapterIds: [], title: '总纲', content: '追寻信件' })
  data.plotlines.push({ id: 'plot', kind: 'main', title: '主线', content: '失踪之谜' })
  data.cards.push({ id: 'card', title: '相遇', content: '雨中对话', summary: '初见', status: 'planned', plotlineId: 'plot', storyTime: '', timeOrder: 1, chapterIds: [chapter.id] })
  data.foreshadows.push({ id: 'hint', title: '旧信', content: '信上的印记', status: 'unplanted', chapterIds: [], plantedChapterIds: [], plannedChapterIds: [], resolvedChapterIds: [], cardIds: [] })
  planning.save(novel.id, 0, data)
  return { dir, db, novels, bible, planning, novel, chapter, previous, person, world, foreign, contexts: new AiContext(novels, bible, planning), close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
test('model catalog reads only allowlisted server secrets and exposes no secret or endpoint', () => {
  const env = { STORYFORGE_AI_API_KEY: 'openai-test-secret', STORYFORGE_DEEPSEEK_API_KEY: 'deepseek-test-secret' }
  const models = loadAiModels(env)
  assert.deepEqual(models.map(item => item.provider), ['openai', 'deepseek'])
  assert.equal(models[1].apiKey, env.STORYFORGE_DEEPSEEK_API_KEY)
  const wire = JSON.stringify(models.map(publicModel))
  for (const secret of Object.values(env)) assert.ok(!wire.includes(secret))
  assert.ok(!wire.includes('https://'))
  assert.ok(models.map(publicModel).every(item => item.configured))
  assert.ok(loadAiModels({}).map(publicModel).every(item => !item.configured))
  assert.equal(loadAiModels({ STORYFORGE_DEEPSEEK_API_KEY: '  ' })[1].model, 'deepseek-chat')
  assert.equal(publicModel(loadAiModels({ STORYFORGE_DEEPSEEK_API_KEY: '  ' })[1]).configured, false)
  const entry = { id: 'local', label: '本地兼容', provider: 'compatible', model: 'local-fiction', baseUrl: 'http://127.0.0.1:1234/v1', keyEnv: 'STORYFORGE_LOCAL_API_KEY', maxOutputTokens: 512 }
  assert.equal(loadAiModels({ STORYFORGE_AI_MODELS_JSON: JSON.stringify([entry]), STORYFORGE_LOCAL_API_KEY: 'local-test' })[0].model, 'local-fiction')
  for (const patch of [{ keyEnv: 'AWS_SECRET_ACCESS_KEY' }, { apiKey: 'must-not-be-inline' }, { provider: '__proto__' }, { baseUrl: 'http://remote.invalid' }, { maxOutputTokens: 9000 }, { inputUsdPerMillion: -1 }, { inputUsdPerMillion: 1 }]) assert.throws(() => loadAiModels({ STORYFORGE_AI_MODELS_JSON: JSON.stringify([{ ...entry, ...patch }]) }))
  assert.throws(() => loadAiModels({ STORYFORGE_AI_MODELS_JSON: JSON.stringify([entry, entry]) }))
})
test('generation parameters are bounded and actually reach the compatible API transport', async () => {
  const parameters = { temperature: 0.3, topP: 0.8, maxOutputTokens: 512 }
  assert.deepEqual(generationParameters(parameters, model), parameters)
  assert.equal(generationParameters(undefined, model).maxOutputTokens, 1024)
  for (const value of [{ ...parameters, temperature: -1 }, { ...parameters, topP: 1.1 }, { ...parameters, maxOutputTokens: 1025 }, { ...parameters, maxOutputTokens: 1.5 }, { ...parameters, apiKey: 'bad' }, [], 'bad']) assert.throws(() => generationParameters(value, model))
  const transport: typeof fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    assert.equal(body.temperature, 0.3); assert.equal(body.top_p, 0.8); assert.equal(body.max_tokens, 512)
    return Response.json({ choices: [{ message: { content: '虚构结果' }, finish_reason: 'stop' }] })
  }
  assert.equal((await new OpenAiProvider({ ...model, parameters }, transport).generate(input, '', new AbortController().signal)).text, '虚构结果')
})
test('reference choices are metadata only and exact selected sources are bounded and fingerprinted', () => {
  const f = fixture()
  try {
    const choices = f.contexts.choices(f.chapter.id)
    assert.deepEqual(new Set(choices.map(item => item.kind)), new Set(['character', 'world', 'outline', 'plotline', 'card', 'foreshadow', 'chapter']))
    assert.ok(!JSON.stringify(choices).includes('克制而勇敢'))
    assert.ok(!JSON.stringify(choices).includes(f.foreign.id))
    assert.ok(!choices.some(item => item.id === f.chapter.id))
    const selection = { references: choices.map(({ kind, id }) => ({ kind, id })), maxCharacters: 1000 }
    const preview = f.contexts.preview(f.chapter.id, selection)
    assert.ok(preview.characters <= 1000)
    assert.ok(preview.sources.every(item => item.characters > 0))
    assert.ok(preview.sources.some(item => item.truncated))
    assert.ok(preview.text.includes('克制而勇敢')); assert.ok(preview.text.includes('已有章节'))
    assert.ok(!preview.text.includes('不发送'))
    assert.equal(preview.fingerprint, f.contexts.preview(f.chapter.id, selection).fingerprint)
    const smaller = f.contexts.preview(f.chapter.id, { ...selection, maxCharacters: 256 })
    assert.ok(smaller.characters <= 256)
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(preview.text))
    const onlyPerson = f.contexts.preview(f.chapter.id, { references: [{ kind: 'character', id: f.person.id }], maxCharacters: 1000 })
    assert.ok(!onlyPerson.text.includes('😀')); assert.ok(!onlyPerson.text.includes('已有章节'))
    f.bible.saveCharacter(f.novel.id, { ...f.person, name: '星河更新' }, f.person.id, f.person.version)
    assert.notEqual(f.contexts.preview(f.chapter.id, selection).fingerprint, preview.fingerprint)
    assert.throws(() => f.contexts.preview(f.chapter.id, { references: [{ kind: 'world', id: f.foreign.id }], maxCharacters: 1000 }))
    assert.throws(() => f.contexts.preview(f.chapter.id, { references: [{ kind: 'chapter', id: f.chapter.id }], maxCharacters: 1000 }))
    for (const context of [{ ...selection, maxCharacters: 1 }, { ...selection, maxCharacters: 12001 }, { ...selection, references: Array(9).fill(selection.references[0]) }, { ...selection, fingerprint: 'invalid' }, { ...selection, references: [selection.references[0], selection.references[0]] }]) assert.throws(() => validateContext(context))
  } finally { f.close() }
})
test('budgets enforce rate, input, session token/count and configured cost caps without refunds', () => {
  const policy = loadAiPolicy({}), estimate = { inputTokensUpperBound: 100, reservedTokens: 200, maxUsd: 0.1 }
  let now = 100000
  const budget = new AiBudget({ ...policy, requestsPerMinute: 2, sessionRequests: 3 }, () => now)
  budget.reserve(estimate); budget.reserve(estimate)
  assert.throws(() => budget.reserve(estimate), /每分钟/)
  now += 60000; budget.reserve(estimate)
  assert.throws(() => budget.reserve(estimate), /会话预算/)
  assert.equal(budget.remaining().requests, 0); assert.equal(budget.remaining().tokens, policy.sessionTokens - 600)
  assert.throws(() => new AiBudget({ ...policy, maxInputTokens: 99 }).reserve(estimate), /输入预算/)
  assert.throws(() => new AiBudget({ ...policy, sessionTokens: 199 }).reserve(estimate), /会话预算/)
  assert.throws(() => new AiBudget({ ...policy, maxRequestUsd: 0.01 }).reserve(estimate), /费用/)
  const monetary = new AiBudget({ ...policy, sessionUsd: 0.15 }); monetary.reserve(estimate)
  assert.throws(() => monetary.reserve(estimate), /费用/)
  for (const env of [{ STORYFORGE_AI_REQUESTS_PER_MINUTE: '0' }, { STORYFORGE_AI_SESSION_TOKENS: 'Infinity' }, { STORYFORGE_AI_MAX_REQUEST_USD: '-1' }]) assert.throws(() => loadAiPolicy(env))
  const unknown = estimateRequest([{ content: '😀中文' }], defaultGeneration, { ...model, inputUsdPerMillion: null, outputUsdPerMillion: null })
  assert.equal(unknown.maxUsd, null); assert.ok(unknown.inputTokensUpperBound > '😀中文'.length)
})
test('comparison respects Unicode and an AI history event undoes independently of surrounding typing', () => {
  assert.deepEqual(compareText('你好😀旧句。', '你好😀新句。'), { prefix: '你好😀', removed: '旧', added: '新', suffix: '句。', identical: false })
  assert.equal(compareText('相同', '相同').identical, true)
  assert.equal(compareText('', '<script>').added, '<script>')
  const schema = getSchema([StarterKit])
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '原文' }] }] }), plugins: [history()] })
  state = state.apply(state.tr.insertText('先前输入', 1))
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 3)))
  const before = state.doc
  state = state.apply(aiTransaction(state, captureAiSnapshot(state), 'polish', 'AI新文')!)
  state = state.apply(closeHistory(state.tr))
  const applied = state.doc
  state = state.apply(state.tr.insertText('后续输入', state.doc.content.size - 1))
  const dispatch = (tr: Parameters<EditorState['apply']>[0]) => { state = state.apply(tr) }
  assert.equal(undo(state, dispatch), true); assert.ok(state.doc.eq(applied))
  assert.equal(undo(state, dispatch), true); assert.ok(state.doc.eq(before))
  assert.equal(redo(state, dispatch), true); assert.ok(state.doc.eq(applied))
})
test('HTTP model routing, context change checks and rate limits run before any Mock provider call', async () => {
  const f = fixture()
  const calls: { model: string; story: string; maxTokens?: number }[] = []
  const server = createApp(f.db, undefined, { models: () => [model, { ...model, id: 'deepseek', provider: 'deepseek', model: 'deepseek-mock' }, { ...model, id: 'unconfigured', apiKey: '' }], policy: { ...loadAiPolicy({}), requestsPerMinute: 2 }, provider: config => ({ generate: async (_input, story) => { calls.push({ model: config.model, story, maxTokens: config.parameters?.maxOutputTokens }); return { text: 'Mock 结果', usage: { inputTokens: 10, outputTokens: 4 }, finishReason: 'stop' } } }) }).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
    const base = `http://127.0.0.1:${address.port}/api`
    const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const before = f.novels.exportData(f.novel.id)
    const catalog = await fetch(base + '/ai/models'); const wire = await catalog.text()
    assert.ok(!wire.includes(model.apiKey)); assert.ok(!wire.includes(model.baseUrl))
    const request = { ...input, chapterId: f.chapter.id, modelId: 'deepseek', parameters: { ...defaultGeneration, maxOutputTokens: 512 } }
    assert.equal((await post('/ai/generate', { ...request, apiKey: 'client-secret' })).status, 400)
    assert.equal((await post('/ai/generate', { ...request, modelId: 'missing' })).status, 400)
    assert.equal((await post('/ai/generate', { ...request, modelId: 'unconfigured' })).status, 503)
    const context: ContextSelection = { references: [{ kind: 'world', id: f.world.id }, { kind: 'chapter', id: f.previous.id }], maxCharacters: 1000 }
    const previewResponse = await post('/ai/context/preview', { chapterId: f.chapter.id, context })
    assert.equal(previewResponse.status, 200)
    const preview = await previewResponse.json() as { fingerprint: string; text: string }
    assert.equal((await post('/ai/generate', { ...request, context })).status, 409)
    assert.equal(calls.length, 0)
    assert.equal((await post('/ai/generate', { ...request, context: { ...context, fingerprint: preview.fingerprint } })).status, 200)
    assert.deepEqual(calls[0], { model: 'deepseek-mock', story: preview.text, maxTokens: 512 })
    f.bible.saveWorld(f.novel.id, { ...f.world, description: '改变后的世界观' }, f.world.id, f.world.version)
    assert.equal((await post('/ai/generate', { ...request, context: { ...context, fingerprint: preview.fingerprint } })).status, 409)
    assert.equal(calls.length, 1)
    assert.equal((await post('/ai/generate', { ...request, modelId: 'mock' })).status, 200)
    assert.equal(calls[1].story, '')
    assert.equal(calls[1].model, 'mock-model')
    assert.equal((await post('/ai/generate', request)).status, 429)
    assert.equal(calls.length, 2)
    assert.deepEqual(f.novels.exportData(f.novel.id), before)
    const cross = await post('/ai/context/preview', { chapterId: f.chapter.id, context: { ...context, references: [{ kind: 'world', id: f.foreign.id }] } })
    assert.equal(cross.status, 404)
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.close() }
})
