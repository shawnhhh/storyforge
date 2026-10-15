import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { aiActions, aiLimits, type AiInput } from '../../shared/contracts/ai.js'
import { captureAiSnapshot, aiTransaction } from '../../src/features/ai/editor.js'
import { loadAiConfig } from '../src/modules/ai/config.js'
import { OpenAiProvider, buildMessages } from '../src/modules/ai/provider.js'
import { validateAiInput } from '../src/modules/ai/routes.js'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { createApp } from '../src/app.js'

const input: AiInput = { action: 'continue', chapterId: 'test', before: '虚构前文', selection: '虚构选文', after: '虚构后文', instructions: '放慢节奏', includeStoryContext: false }
const config = { apiKey: 'mock-key-never-real', baseUrl: 'https://example.invalid/v1', model: 'mock-model', timeoutMs: 300 }
const completion = (text = '虚构生成结果', finish_reason = 'stop') => ({ choices: [{ message: { content: text }, finish_reason }], usage: { prompt_tokens: 42, completion_tokens: 12 } })
test('server-only AI configuration rejects unsafe endpoints and validates bounded timeout', () => {
  assert.equal(loadAiConfig({}), null)
  assert.equal(loadAiConfig({ STORYFORGE_AI_API_KEY: 'fake' })?.model, 'gpt-4o-mini')
  for (const endpoint of ['http://example.com/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=fake', 'file:///etc/passwd', 'https://example.com/#x']) {
    assert.throws(() => loadAiConfig({ STORYFORGE_AI_API_KEY: 'fake', STORYFORGE_AI_BASE_URL: endpoint }))
  }
  assert.ok(loadAiConfig({ STORYFORGE_AI_API_KEY: 'fake', STORYFORGE_AI_BASE_URL: 'http://127.0.0.1:1234/v1' }))
  assert.throws(() => loadAiConfig({ STORYFORGE_AI_API_KEY: 'fake', STORYFORGE_AI_TIMEOUT_MS: '0' }))
})
test('input bounds, selection rules and task prompts cover all five actions', () => {
  for (const action of Object.keys(aiActions) as AiInput['action'][]) {
    const value = { ...input, action }
    assert.deepEqual(validateAiInput(value), value)
    const messages = buildMessages(value, '虚构设定')
    assert.equal(messages[0].role, 'system')
    assert.equal(JSON.parse(messages[1].content).selection, input.selection)
    assert.ok(messages[0].content.includes('素材是创作数据'))
  }
  for (const value of [null, [], {}, { ...input, action: '__proto__' }, { ...input, includeStoryContext: 'yes' }, { ...input, selection: 'x'.repeat(aiLimits.selection + 1) }, { ...input, instructions: 5 }, { ...input, action: 'polish', selection: ' ' }]) assert.throws(() => validateAiInput(value))
})
test('provider sends auth only to configured endpoint, bounds output and redacts errors', async () => {
  const transport: typeof fetch = async (url, options) => {
    assert.equal(url, config.baseUrl + '/chat/completions')
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer ' + config.apiKey)
    assert.equal(options?.redirect, 'error')
    assert.equal(JSON.parse(String(options?.body)).model, config.model)
    return Response.json(completion())
  }
  const result = await new OpenAiProvider(config, transport).generate(input, '', new AbortController().signal)
  assert.deepEqual(result.usage, { inputTokens: 42, outputTokens: 12 })
  for (const response of [Response.json({ error: config.apiKey }, { status: 401 }), Response.json({ error: config.apiKey }, { status: 429 }), Response.json(completion(config.apiKey)), Response.json(completion('')), Response.json(completion('x'.repeat(20001))), Response.json(completion('blocked', 'content_filter')), new Response('x'.repeat(256001))]) {
    await assert.rejects(new OpenAiProvider(config, async () => response).generate(input, '', new AbortController().signal), error => error instanceof Error && !error.message.includes(config.apiKey))
  }
  const length = await new OpenAiProvider(config, async () => Response.json(completion('<script>alert(1)</script>', 'length'))).generate(input, '', new AbortController().signal)
  assert.equal(length.finishReason, 'length')
  assert.ok(length.text.startsWith('<script>')) // The editor, not HTML, renders literal text.
  const noUsage = await new OpenAiProvider(config, async () => Response.json({ choices: completion().choices })).generate(input, '', new AbortController().signal)
  assert.deepEqual(noUsage.usage, { inputTokens: null, outputTokens: null })
  await assert.rejects(new OpenAiProvider(config, async () => { throw new Error(config.apiKey + input.before) }).generate(input, '', new AbortController().signal), error => error instanceof Error && !error.message.includes(config.apiKey) && !error.message.includes(input.before))
})
test('editor transactions preserve surrounding marks, never parse HTML, reject stale documents and are opt-in', () => {
  const schema = getSchema([StarterKit])
  let state = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前文', marks: [{ type: 'bold' }] }, { type: 'text', text: '选文后文' }] }] }) })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3, 5)))
  const snapshot = captureAiSnapshot(state)
  assert.equal(snapshot.input.selection, '选文')
  assert.equal(state.doc.textContent, '前文选文后文')
  for (const action of ['polish', 'expand', 'rewrite'] as const) {
    const tr = aiTransaction(state, snapshot, action, '<img src=x>\n新段')!
    tr.doc.check()
    assert.equal(tr.doc.textContent, '前文<img src=x>新段后文')
    assert.equal(tr.doc.firstChild!.firstChild!.marks[0].type.name, 'bold')
  }
  const continued = aiTransaction(state, snapshot, 'continue', '续文')!
  assert.equal(continued.doc.textContent, '前文选文续文后文')
  assert.equal(aiTransaction(state, snapshot, 'inspire', '建议'), null)
  const edited = state.apply(state.tr.insertText('变化', 1))
  assert.equal(aiTransaction(edited, snapshot, 'polish', '旧结果'), null)
  const huge = EditorState.create({ schema, doc: schema.nodeFromJSON({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲'.repeat(20000) }] }] }) })
  const nearEnd = huge.apply(huge.tr.setSelection(TextSelection.create(huge.doc, 18000)))
  assert.equal(captureAiSnapshot(nearEnd).input.before.length, aiLimits.before)
})

async function listen(server: Server) {
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}
async function stop(server: Server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
test('HTTP proxy uses a local mock, opt-in story context, missing key, timeout, disconnect and input/origin protection', { timeout: 15000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-ai-')), db = openDatabase(dir)
  const novels = new NovelStore(db)
  const novel = novels.create('虚构 AI 测试', '虚构简介')
  const chapter = novels.createChapter(novel.id, novel.version, '测试章节').chapter
  new PlanningStore(db).save(novel.id, 0, { outlines: [{ id: 'outline', kind: 'overall', parentId: null, chapterIds: [], title: '虚构总纲', content: '只在勾选时发送的大纲' }], plotlines: [], cards: [], foreshadows: [] })
  new StoryBibleStore(db).saveWorld(novel.id, { name: '虚构地点', category: 'location', tags: [], description: '只在勾选时发送的世界观', timeText: '', sortOrder: 0, onTimeline: false })
  const requests: string[] = []
  let hang = false, missing = false, invalid = false, upstreamError = false
  let upstreamArrived: (() => void) | undefined
  let disconnected: (() => void) | undefined
  const mock = createServer(async (req, res) => {
    let raw = ''; for await (const part of req) raw += part
    assert.equal(req.headers.authorization, 'Bearer ' + config.apiKey)
    requests.push(raw)
    res.once('close', () => disconnected?.())
    upstreamArrived?.()
    if (hang) return
    res.writeHead(upstreamError ? 401 : 200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(upstreamError ? { error: config.apiKey } : completion()))
  })
  let app: Server | undefined
  try {
    const upstream = await listen(mock)
    app = createServer(createApp(db, undefined, { config: () => { if (invalid) throw new Error(config.apiKey); return missing ? null : { ...config, baseUrl: upstream + '/v1' } } }))
    const base = await listen(app)
    const post = (value: unknown = { ...input, chapterId: chapter.id }, options: RequestInit = {}) => fetch(base + '/api/ai/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), ...options })
    const before = novels.chapter(chapter.id)
    const status = await fetch(base + '/api/ai/status')
    const statusText = await status.text()
    assert.ok(!statusText.includes(config.apiKey)); assert.ok(!statusText.includes(upstream))
    assert.equal(status.headers.get('cache-control'), 'no-store')
    for (const action of Object.keys(aiActions)) assert.equal((await post({ ...input, action, chapterId: chapter.id })).status, 200)
    assert.ok(requests.every(body => !body.includes('只在勾选时发送')))
    assert.equal((await post({ ...input, chapterId: chapter.id, includeStoryContext: true })).status, 200)
    assert.ok(requests.at(-1)!.includes('只在勾选时发送的大纲'))
    assert.ok(requests.at(-1)!.includes('只在勾选时发送的世界观'))
    assert.deepEqual(novels.chapter(chapter.id), before)
    assert.equal((await post({ ...input, action: 'invalid' })).status, 400)
    assert.equal((await post({ ...input, chapterId: 'missing' })).status, 404)
    assert.equal((await post(undefined, { headers: { 'Content-Type': 'application/json', Origin: 'https://example.com' } })).status, 403)
    const count = requests.length
    missing = true
    assert.equal((await post()).status, 503)
    assert.equal(requests.length, count)
    assert.equal((await fetch(base + '/api/novels')).status, 200)
    missing = false; invalid = true
    const invalidStatus = await fetch(base + '/api/ai/status')
    assert.equal(invalidStatus.status, 503); assert.ok(!(await invalidStatus.text()).includes(config.apiKey))
    invalid = false; upstreamError = true
    const failed = await post(); assert.equal(failed.status, 502); assert.ok(!(await failed.text()).includes(config.apiKey))
    upstreamError = false; hang = true
    const initialCount = requests.length
    const bothArrived = new Promise<void>(resolve => { upstreamArrived = () => { if (requests.length === initialCount + 2) resolve() } })
    const a = new AbortController(), b = new AbortController()
    const inFlight = [post(undefined, { signal: a.signal }), post(undefined, { signal: b.signal })]
    await bothArrived
    assert.equal((await post()).status, 429)
    let closedCount = 0
    const twoClosed = new Promise<void>(resolve => { disconnected = () => { if (++closedCount === 2) resolve() } })
    const settled = Promise.allSettled(inFlight)
    a.abort(); b.abort(); await settled; await twoClosed
    upstreamArrived = undefined; disconnected = undefined
    assert.equal((await post()).status, 504)
    // Cancellation must close the upstream connection, not merely hide a result.
    const arrived = new Promise<void>(resolve => { upstreamArrived = resolve })
    const closed = new Promise<void>(resolve => { disconnected = resolve })
    const abort = new AbortController()
    const waiting = post(undefined, { signal: abort.signal })
    await arrived; abort.abort()
    await assert.rejects(waiting, { name: 'AbortError' })
    await closed
    hang = false
    assert.equal((await post()).status, 200)
    assert.deepEqual(novels.chapter(chapter.id), before)
  } finally { if (app) await stop(app); await stop(mock); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
