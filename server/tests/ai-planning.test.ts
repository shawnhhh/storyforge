import { OpenAiProvider } from '../src/modules/ai/provider.js'
import { characterProposal } from '../../tests/fixtures/ai-planning.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { AiContext } from '../src/modules/ai/context.js'
import { AiPlanning, parseProposal, validateProposal } from '../src/modules/ai/planning.js'
import { createApp } from '../src/app.js'
import { loadAiPolicy } from '../src/modules/ai/budget.js'
import type { AiCatalog } from '../../shared/contracts/ai.js'
import type { AiModel } from '../src/modules/ai/models.js'
import type { AiDependencies } from '../src/modules/ai/routes.js'
import type { PlanningGenerationInput, PlanningRequestPreview, PlanningGenerationResult } from '../../shared/contracts/ai-planning.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newWorld } from '../../src/features/story-bible/model.js'
const model: AiModel = { id: 'mock', label: '模拟模型', provider: 'compatible', model: 'fiction-only', apiKey: 'fake-never-real-key', baseUrl: 'https://example.invalid/v1', timeoutMs: 60, maxOutputTokens: 1024, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
const proposal = { title: '云海', content: '虚构设定：文明位于浮空岛，资源限制带来冲突。<script>仅为文本</script>' }
const completion = { text: JSON.stringify(proposal), usage: { inputTokens: 30, outputTokens: 40 }, finishReason: 'stop' as const }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-ai-planning-')), db = openDatabase(dir)
  const novels = new NovelStore(db), planning = new PlanningStore(db), bible = new StoryBibleStore(db)
  const novel = novels.create('虚构小说', '不可自动发送的简介'), chapter = novels.createChapter(novel.id, novel.version, '第一章').chapter
  const other = novels.create('其他小说', '')
  const person = bible.saveCharacter(novel.id, { name: '原有人物', ...characterProposal.character!, fields: { ...characterProposal.character!.fields, notes: '原有备注' }, relations: [], worldIds: [] })
  const original = bible.saveWorld(novel.id, { ...newWorld(), name: '原稿设定', description: '不可自动发送的设定原文' })
  const foreign = bible.saveWorld(other.id, { ...newWorld(), name: '跨小说设定' })
  const plan = emptyPlanning()
  plan.outlines.push({ id: 'overall', title: '原有总纲', content: '保留内容', kind: 'overall', parentId: null, chapterIds: [] })
  planning.save(novel.id, 0, plan)
  let now = 100000
  let catalog = [model]
  const contexts = new AiContext(novels, bible, planning)
  const service = new AiPlanning(novels, planning, bible, contexts, () => now, () => catalog)
  const input: PlanningGenerationInput = { novelId: novel.id, kind: 'world', instructions: '悬疑，原创浮空文明', modelId: 'mock', parameters: { temperature: 0.7, topP: 1, maxOutputTokens: 512 }, context: { references: [], maxCharacters: 1000 }, parentId: null, chapterIds: [] }
  return { setModels: (value: AiModel[]) => { catalog = value }, dir, db, novels, planning, bible, novel, chapter, person, original, foreign, contexts, service, input, tick: () => { now += 1800001 }, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
test('planning preview is read-only, explicit sources only, binds settings and never exposes keys', () => {
  const f = fixture()
  try {
    const before = f.planning.read(f.novel.id), bible = f.bible.list(f.novel.id)
    const preview = f.service.preview(f.service.validate(f.input), model)
    assert.ok(!JSON.stringify(preview).includes(model.apiKey))
    assert.ok(!JSON.stringify(preview.messages).includes('不可自动发送'))
    assert.deepEqual(f.planning.read(f.novel.id), before); assert.deepEqual(f.bible.list(f.novel.id), bible)
    const selected = { ...f.input, context: { references: [{ kind: 'world' as const, id: f.original.id }], maxCharacters: 1000 } }
    const explicit = f.service.preview(selected, model)
    assert.ok(JSON.stringify(explicit.messages).includes('不可自动发送的设定原文'))
    assert.notEqual(explicit.fingerprint, preview.fingerprint)
    assert.notEqual(f.service.preview({ ...f.input, instructions: '另一要求' }, model).fingerprint, preview.fingerprint)
    assert.deepEqual(f.service.validate({ ...f.input, fingerprint: preview.fingerprint }), f.input)
    assert.throws(() => f.service.preview({ ...selected, context: { ...selected.context, references: [{ kind: 'world', id: f.foreign.id }] } }, model))
    assert.ok(f.contexts.choicesNovel(f.novel.id).some(row => row.id === f.chapter.id))
    assert.ok(!f.contexts.choicesNovel(f.novel.id).some(row => row.id === f.foreign.id))
  } finally { f.close() }
})
for (const kind of ['world', 'character', 'volume', 'chapter'] as const) test(`${kind}: confirmation appends edited preview, preserves original IDs/content and is idempotent`, () => {
  const f = fixture()
  try {
    const input = { ...f.input, kind, parentId: kind === 'volume' ? 'overall' : null, chapterIds: kind === 'chapter' ? [f.chapter.id] : [] }
    f.service.validate(input)
    const before = { plan: f.planning.read(f.novel.id), bible: f.bible.list(f.novel.id), chapter: f.novels.chapter(f.chapter.id) }
    const token = f.service.retain(input, f.service.baseline(input))
    assert.throws(() => f.service.save({ ...token, proposal, confirmed: false }))
    const save = { previewId: token.previewId, proposal: { ...(kind === 'character' ? characterProposal : proposal), title: '用户编辑标题' }, confirmed: true }
    const result = f.service.save(save)
    assert.deepEqual(f.service.save(save), result)
    assert.throws(() => f.service.save({ ...save, proposal: { ...proposal, title: '重复保存修改' } }))
    const after = f.bible.list(f.novel.id), plan = f.planning.read(f.novel.id)
    assert.deepEqual(after.world.find(row => row.id === f.original.id), f.original)
    assert.deepEqual(plan.outlines.find(row => row.id === 'overall'), before.plan.outlines[0])
    assert.deepEqual(f.novels.chapter(f.chapter.id), before.chapter)
    if (kind === 'world') assert.equal(after.world.find(row => row.id === result.id)?.description, proposal.content)
    if (kind === 'character') { const person = after.characters.find(row => row.id === result.id)!; assert.equal(person.fields.notes, proposal.content); assert.deepEqual(person.fields, { ...characterProposal.character!.fields, notes: proposal.content }); assert.deepEqual(person.tags, characterProposal.character!.tags); assert.equal(person.category, '主角') }
    if (kind === 'volume' || kind === 'chapter') {
      const entry = plan.outlines.find(row => row.id === result.id)!
      assert.equal(entry.title, '用户编辑标题'); assert.equal(entry.parentId, input.parentId); assert.deepEqual(entry.chapterIds, input.chapterIds)
      assert.equal(plan.outlines.length, before.plan.outlines.length + 1)
    }
  } finally { f.close() }
})
test('stale, expired, forged and deleted-novel previews cannot write data', () => {
  const f = fixture()
  try {
    const token = f.service.retain(f.input, f.service.baseline(f.input))
    f.bible.saveWorld(f.novel.id, { ...f.original, description: '另一窗口修改' }, f.original.id, f.original.version)
    assert.throws(() => f.service.save({ previewId: token.previewId, proposal, confirmed: true }), /已变化/)
    const fresh = f.service.retain(f.input, f.service.baseline(f.input)); f.tick()
    assert.throws(() => f.service.save({ previewId: fresh.previewId, proposal, confirmed: true }), /过期/)
    assert.throws(() => f.service.save({ previewId: 'forged', proposal, confirmed: true }))
    const deleted = f.service.retain(f.input, f.service.baseline(f.input))
    f.db.prepare('DELETE FROM novels WHERE id=?').run(f.novel.id)
    assert.throws(() => f.service.save({ previewId: deleted.previewId, proposal, confirmed: true }), /不存在/)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM novels WHERE id=?').get(f.novel.id)?.count, 0)
  } finally { f.close() }
})
test('strict JSON, bounds, hierarchy and cross-novel links reject malformed AI or user data', () => {
  const f = fixture()
  try {
    for (const value of [null, [], {}, { title: '', content: 'x' }, { title: 'x', content: '' }, { title: 'x'.repeat(201), content: 'x' }, { ...proposal, content: 'x'.repeat(20001) }, { ...proposal, id: 'original' }]) assert.throws(() => validateProposal(value))
    for (const value of ['```json\n{}\n```', 'plain text', '{"title":"截断"', '{}']) assert.throws(() => parseProposal(value))
    for (const value of [{ ...f.input, kind: '__proto__' }, { ...f.input, overwrite: true }, { ...f.input, parentId: 'absent' }, { ...f.input, kind: 'chapter', parentId: 'overall' }, { ...f.input, chapterIds: [f.chapter.id] }, { ...f.input, kind: 'chapter', chapterIds: [f.foreign.id] }, { ...f.input, instructions: 'x'.repeat(1001) }, { ...f.input, context: { references: [], maxCharacters: 12001 } }]) assert.throws(() => f.service.validate(value))
    assert.deepEqual(parseProposal(JSON.stringify(proposal)), proposal)
  } finally { f.close() }
})
async function apiFixture(extra: AiDependencies = {}) {
  const f = fixture(), calls: string[] = []
  const server = createApp(f.db, undefined, { models: () => [model], policy: loadAiPolicy({}), provider: () => ({ generate: async (_input, story) => { calls.push(story); return completion } }), ...extra }).listen(0, '127.0.0.1')
  try { await once(server, 'listening') } catch (error) { f.close(); throw error }
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const send = async (path: string, data?: unknown, signal?: AbortSignal) => fetch(`http://127.0.0.1:${address.port}/api${path}`, { method: data === undefined ? 'GET' : 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
  return { ...f, calls, send, stop: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); f.close() } }
}
test('API enforces preview before generation, confirmation before save, and shares writing budgets', async () => {
  const f = await apiFixture({ policy: { ...loadAiPolicy({}), sessionRequests: 1 } })
  try {
    assert.equal((await f.send('/ai/planning/generate', f.input)).status, 409)
    const response = await f.send('/ai/planning/preview', f.input); assert.equal(response.status, 200)
    const preview = await response.json() as PlanningRequestPreview
    assert.equal(f.calls.length, 0)
    const generated = await f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint }); assert.equal(generated.status, 200)
    const result = await generated.json() as PlanningGenerationResult
    assert.deepEqual(result.proposal, proposal); assert.equal(f.bible.list(f.novel.id).world.length, 1)
    assert.equal((await f.send('/ai/planning/save', { previewId: result.previewId, proposal, confirmed: false })).status, 400)
    assert.equal((await f.send('/ai/planning/save', { previewId: result.previewId, proposal, confirmed: true })).status, 200)
    assert.equal(f.bible.list(f.novel.id).world.length, 2)
    const writing = { action: 'continue', chapterId: f.chapter.id, before: '', after: '', selection: '', instructions: '', includeStoryContext: false, modelId: 'mock', parameters: f.input.parameters }
    assert.equal((await f.send('/ai/generate', writing)).status, 429)
    assert.ok(!f.calls.join('').includes('不可自动发送'))
  } finally { await f.stop() }
})
test('API rejects stale fingerprint, truncated/invalid results, provider errors and hard timeout', async () => {
  for (const mode of ['stale', 'length', 'invalid', 'failure', 'timeout'] as const) {
    const f = await apiFixture({ provider: () => ({ generate: async () => {
      if (mode === 'timeout') return new Promise(() => {})
      if (mode === 'failure') throw new Error('must-never-leak-secret')
      return { ...completion, text: mode === 'invalid' ? 'bad JSON' : completion.text, finishReason: mode === 'length' ? 'length' : 'stop' }
    } }) })
    try {
      const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
      if (mode === 'stale') f.bible.saveWorld(f.novel.id, { ...f.original, name: '新名称' }, f.original.id, f.original.version)
      const response = await f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint })
      assert.equal(response.status, mode === 'stale' ? 409 : mode === 'timeout' ? 504 : 502)
      assert.ok(!(await response.text()).includes('must-never-leak-secret'))
      assert.equal(f.bible.list(f.novel.id).world.length, 1)
    } finally { await f.stop() }
  }
})
test('API cancellation reaches provider without saving or refunding budget', async () => {
  let started!: () => void, aborted!: () => void
  const start = new Promise<void>(resolve => { started = resolve }), abort = new Promise<void>(resolve => { aborted = resolve })
  const f = await apiFixture({ models: () => [{ ...model, timeoutMs: 5000 }], provider: () => ({ generate: async (_input, _story, signal) => { started(); return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')) }, { once: true }) }) } }) })
  try {
    const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const controller = new AbortController()
    const response = f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint }, controller.signal)
    await start; controller.abort(); await assert.rejects(response); await abort
    assert.equal(f.bible.list(f.novel.id).world.length, 1)
    const catalog = await (await f.send('/ai/models')).json() as AiCatalog
    assert.equal(catalog.remaining.requests, 99)
  } finally { await f.stop() }
})
test('API planning input/token/cost limits reject before provider invocation', async () => {
  for (const [policy, expected] of [[{ maxInputTokens: 1 }, 413], [{ sessionTokens: 1 }, 429], [{ maxRequestUsd: 0.000001 }, 429]] as const) {
    const f = await apiFixture({ policy: { ...loadAiPolicy({}), ...policy } })
    try {
      const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
      const response = await f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint })
      assert.equal(response.status, expected); assert.equal(f.calls.length, 0)
      assert.equal(f.bible.list(f.novel.id).world.length, 1)
    } finally { await f.stop() }
  }
})
test('characters require editable structured fields and reuse biography validation without notes fallback', () => {
  const f = fixture()
  try {
    assert.deepEqual(parseProposal(JSON.stringify(characterProposal), 'character'), characterProposal)
    for (const value of [proposal, { ...characterProposal, character: {} }, { ...characterProposal, character: { ...characterProposal.character, fields: {} } }, { ...characterProposal, character: { ...characterProposal.character, tags: ['重复', '重复'] } }, { ...characterProposal, character: { ...characterProposal.character, fields: { ...characterProposal.character!.fields, identity: 1 } } }, { ...characterProposal, character: { ...characterProposal.character, fields: { ...characterProposal.character!.fields, notes: '双重备注' } } }]) assert.throws(() => validateProposal(value, 'character'))
    assert.throws(() => validateProposal(characterProposal, 'world'))
    const input = { ...f.input, kind: 'character' as const }, token = f.service.retain(input, f.service.baseline(input))
    const edited = { ...characterProposal, character: { ...characterProposal.character!, fields: { ...characterProposal.character!.fields, identity: '用户修订的身份', goals: '用户修订的目标' } } }
    const saved = f.service.save({ previewId: token.previewId, proposal: edited, confirmed: true })
    const person = f.bible.character(f.novel.id, saved.id)
    assert.equal(person.fields.identity, edited.character.fields.identity); assert.equal(person.fields.goals, edited.character.fields.goals)
    assert.equal(person.fields.notes, edited.content); assert.deepEqual(person.relations, []); assert.deepEqual(person.worldIds, [])
  } finally { f.close() }
})
for (const change of ['novel', 'character', 'world', 'chapter', 'planning', 'insert', 'delete', 'model', 'key', 'endpoint', 'price', 'cap', 'timeout', 'removed-model'] as const) test(`pending preview permanently invalidates on ${change} change and never writes`, () => {
  const f = fixture()
  try {
    const token = f.service.retain(f.input, f.service.baseline(f.input))
    if (change === 'novel') { const novel = f.novels.novel(f.novel.id); f.novels.update(novel.id, novel.version, '新小说名', novel.description) }
    if (change === 'character') f.bible.saveCharacter(f.novel.id, { ...f.person, fields: { ...f.person.fields, personality: '另一窗口修改性格' } }, f.person.id, f.person.version)
    if (change === 'world') f.bible.saveWorld(f.novel.id, { ...f.original, name: '已修改' }, f.original.id, f.original.version)
    if (change === 'chapter') f.novels.saveChapter(f.chapter.id, f.chapter.version, '新章名', f.chapter.content)
    if (change === 'planning') { const plan = f.planning.read(f.novel.id); f.planning.save(f.novel.id, plan.version, { ...plan, outlines: plan.outlines.map(row => ({ ...row, title: '新大纲' })) }) }
    if (change === 'insert') f.bible.saveWorld(f.novel.id, { ...newWorld(), name: '新增未引用资料' })
    if (change === 'delete') f.bible.remove('world', f.novel.id, f.original.id, f.original.version)
    if (change === 'model') f.setModels([{ ...model, model: 'another-fiction-model' }])
    if (change === 'key') f.setModels([{ ...model, apiKey: 'rotated-fake-key' }])
    if (change === 'endpoint') f.setModels([{ ...model, baseUrl: 'https://other.invalid/v1' }])
    if (change === 'price') f.setModels([{ ...model, outputUsdPerMillion: 9 }])
    if (change === 'cap') f.setModels([{ ...model, maxOutputTokens: 512 }])
    if (change === 'timeout') f.setModels([{ ...model, timeoutMs: 500 }])
    if (change === 'removed-model') f.setModels([])
    const before = { bible: f.bible.list(f.novel.id), plan: f.planning.read(f.novel.id), chapter: f.novels.chapter(f.chapter.id) }
    assert.throws(() => f.service.check(token.previewId), /失效/)
    f.setModels([model]) // Seeing a mismatch permanently retires that preview, even after configuration reverts.
    assert.throws(() => f.service.save({ previewId: token.previewId, proposal, confirmed: true }), /失效/)
    assert.deepEqual({ bible: f.bible.list(f.novel.id), plan: f.planning.read(f.novel.id), chapter: f.novels.chapter(f.chapter.id) }, before)
  } finally { f.close() }
})
test('API model changes during generation and after result preview reject stale results and writes', async () => {
  let current = { ...model, timeoutMs: 5000 }, started!: () => void, finish!: () => void
  const start = new Promise<void>(resolve => { started = resolve }), release = new Promise<void>(resolve => { finish = resolve })
  const f = await apiFixture({ models: () => [current], provider: () => ({ generate: async () => { started(); await release; return completion } }) })
  try {
    const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const pending = f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint })
    await start; current = { ...current, model: 'changed-during-generation' }; finish()
    assert.equal((await pending).status, 409)
    const fresh = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const generated = await (await f.send('/ai/planning/generate', { ...f.input, fingerprint: fresh.fingerprint })).json() as PlanningGenerationResult
    current = { ...current, apiKey: 'rotated-after-preview' }
    assert.equal((await f.send('/ai/planning/check', { previewId: generated.previewId })).status, 409)
    assert.equal((await f.send('/ai/planning/save', { previewId: generated.previewId, proposal, confirmed: true })).status, 409)
    assert.equal(f.bible.list(f.novel.id).world.length, 1)
  } finally { await f.stop() }
})
test('API rejects concurrent duplicate generation before a second charge and simultaneous saves remain idempotent', async () => {
  let started!: () => void, finish!: () => void, count = 0
  const start = new Promise<void>(resolve => { started = resolve }), release = new Promise<void>(resolve => { finish = resolve })
  const f = await apiFixture({ models: () => [{ ...model, timeoutMs: 5000 }], provider: () => ({ generate: async () => { count++; started(); await release; return completion } }) })
  try {
    const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const input = { ...f.input, fingerprint: preview.fingerprint }, first = f.send('/ai/planning/generate', input)
    await start
    assert.equal((await f.send('/ai/planning/generate', input)).status, 409); assert.equal(count, 1)
    finish(); const generated = await (await first).json() as PlanningGenerationResult
    const data = { previewId: generated.previewId, proposal, confirmed: true }
    const [a, b] = await Promise.all([f.send('/ai/planning/save', data), f.send('/ai/planning/save', data)])
    assert.equal(a.status, 200); assert.equal(b.status, 200); assert.deepEqual(await a.json(), await b.json())
    assert.equal(f.bible.list(f.novel.id).world.length, 2)
    const catalog = await (await f.send('/ai/models')).json() as AiCatalog
    assert.equal(catalog.remaining.requests, 99)
  } finally { finish(); await f.stop() }
})
for (const status of [401, 403, 429, 500, 503, 'invalid-json'] as const) test(`API upstream ${status} is redacted and never creates a preview or overwrites data`, async () => {
  const f = await apiFixture({ provider: settings => new OpenAiProvider(settings, async () => status === 'invalid-json' ? new Response('{invalid') : Response.json({ error: 'raw-body-' + model.apiKey }, { status })) })
  try {
    const before = f.bible.list(f.novel.id), preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const response = await f.send('/ai/planning/generate', { ...f.input, fingerprint: preview.fingerprint })
    assert.equal(response.status, status === 429 ? 429 : 502)
    const error = await response.text()
    assert.ok(!error.includes('raw-body')); assert.ok(!error.includes(model.apiKey)); assert.ok(!error.includes('example.invalid'))
    assert.deepEqual(f.bible.list(f.novel.id), before)
    const catalog = await (await f.send('/ai/models')).json() as AiCatalog
    assert.equal(catalog.remaining.requests, 99)
  } finally { await f.stop() }
})
test('API timeout releases concurrency and a retried successful result still requires explicit save', async () => {
  let timedOut = true
  const f = await apiFixture({ provider: () => ({ generate: async () => timedOut ? new Promise(() => {}) : completion }) })
  try {
    const preview = await (await f.send('/ai/planning/preview', f.input)).json() as PlanningRequestPreview
    const data = { ...f.input, fingerprint: preview.fingerprint }
    assert.equal((await f.send('/ai/planning/generate', data)).status, 504)
    assert.equal(f.bible.list(f.novel.id).world.length, 1)
    timedOut = false
    const response = await f.send('/ai/planning/generate', data)
    assert.equal(response.status, 200)
    const result = await response.json() as PlanningGenerationResult
    assert.equal((await f.send('/ai/planning/check', { previewId: result.previewId })).status, 200)
    assert.equal(f.bible.list(f.novel.id).world.length, 1)
    assert.equal((await f.send('/ai/planning/save', { previewId: result.previewId, proposal, confirmed: true })).status, 200)
    const catalog = await (await f.send('/ai/models')).json() as AiCatalog
    assert.equal(catalog.remaining.requests, 98)
  } finally { await f.stop() }
})
