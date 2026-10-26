import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { createApp } from '../src/app.js'
import { loadAiPolicy } from '../src/modules/ai/budget.js'
import { defaultGeneration } from '../../shared/contracts/ai.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import type { AiModel } from '../src/modules/ai/models.js'
import type { PlanningGenerationResult, PlanningRequestPreview } from '../../shared/contracts/ai-planning.js'
import type { ReviewPreview, ReviewResult } from '../../shared/contracts/consistency-review.js'

async function fixture(requests = 10) {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-cross-module-')), db = openDatabase(directory)
  const novels = new NovelStore(db), bible = new StoryBibleStore(db), planning = new PlanningStore(db)
  const novel = novels.create('跨模块虚构验收', '不得自动发送的简介')
  const created = novels.createChapter(novel.id, novel.version, '不可覆盖正文').chapter
  const { chapter } = novels.saveChapter(created.id, created.version, created.title, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '云城允许飞行。🌕' }] }] })
  const existingPlan = emptyPlanning()
  existingPlan.outlines.push({ id: 'original-outline', kind: 'overall', title: '不可覆盖的原有总纲', content: '原有情节与角色安排', parentId: null, chapterIds: [] })
  planning.save(novel.id, 0, existingPlan)
  const model: AiModel = { id: 'mock', label: '测试', provider: 'compatible', model: 'fiction', apiKey: 'isolated-mock-only', baseUrl: 'https://example.invalid/v1', timeoutMs: 1000, maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
  let calls = 0
  const server = createApp(db, undefined, { models: () => [model], policy: { ...loadAiPolicy({}), sessionRequests: requests }, provider: () => ({ generate: async input => {
    calls++
    const text = input.action === 'consistency-review'
      ? JSON.stringify({ findings: [{ category: 'world', certainty: 'conflict', explanation: '规则待核实', suggestion: '核对例外', evidence: [{ sourceId: 'current', quote: '云城允许飞行' }, { sourceId: input.sources[1].id, quote: '云城禁止飞行' }] }] })
      : input.action === 'inspire' ? JSON.stringify({ title: '新增飞行规则', content: '云城禁止飞行。' }) : '只读续写预览'
    return { text, usage: { inputTokens: 10, outputTokens: 10 }, finishReason: 'stop' }
  } }) }).listen(0, '127.0.0.1')
  await once(server, 'listening'); const address = server.address(); assert.ok(address && typeof address !== 'string')
  const send = (path: string, data?: unknown, method = data === undefined ? 'GET' : 'POST') => fetch(`http://127.0.0.1:${address.port}/api${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) })
  const input = { novelId: novel.id, kind: 'world', instructions: '虚构规则', modelId: model.id, parameters: defaultGeneration, context: { references: [], maxCharacters: 6000 }, parentId: null, chapterIds: [] }
  const generate = async () => {
    const p = await send('/ai/planning/preview', input); assert.equal(p.status, 200)
    const preview = await p.json() as PlanningRequestPreview
    const g = await send('/ai/planning/generate', { ...input, fingerprint: preview.fingerprint }); assert.equal(g.status, 200)
    return await g.json() as PlanningGenerationResult
  }
  return { db, novels, bible, planning, novel, chapter, send, input, generate, calls: () => calls, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close() } }
}

test('generated world is referenceable by review, trash invalidates consent, and restore preserves original prose', { timeout: 10000 }, async () => {
  const f = await fixture()
  try {
    const original = f.novels.chapter(f.chapter.id), plan = f.planning.read(f.novel.id)
    const generated = await f.generate()
    assert.equal(f.bible.list(f.novel.id).world.length, 0)
    const saved = await f.send('/ai/planning/save', { previewId: generated.previewId, proposal: generated.proposal, confirmed: true }); assert.equal(saved.status, 200)
    const entry = await saved.json() as { id: string }
    const input = { chapterId: f.chapter.id, chapterText: '云城允许飞行。🌕', modelId: 'mock', parameters: defaultGeneration, context: { references: [{ kind: 'world', id: entry.id }], maxCharacters: 6000 } }
    const preview = await (await f.send('/ai/review/preview', input)).json() as ReviewPreview
    assert.equal(preview.sources[1].id, 'world:' + entry.id)
    const reviewed = await f.send('/ai/review', { ...input, fingerprint: preview.fingerprint }); assert.equal(reviewed.status, 200)
    const result = await reviewed.json() as ReviewResult
    assert.equal(result.findings[0].certainty, 'conflict'); assert.equal(result.findings[0].evidence.length, 2)
    assert.deepEqual(f.novels.chapter(f.chapter.id), original)
    const world = f.bible.list(f.novel.id).world[0]
    assert.equal((await f.send(`/novels/${f.novel.id}/world/${entry.id}`, { version: world.version, confirmed: true }, 'DELETE')).status, 204)
    const beforeRejected = f.calls()
    assert.equal((await f.send('/ai/review', { ...input, fingerprint: preview.fingerprint })).status, 404)
    assert.equal(f.calls(), beforeRejected)
    const trash = await (await f.send('/trash')).json() as { id: string; name: string }[]
    const archived = trash.find(row => row.name === generated.proposal.title); assert.ok(archived)
    assert.equal((await f.send(`/trash/${archived.id}/restore`, { confirmed: true })).status, 204)
    assert.equal(f.bible.list(f.novel.id).world[0].id, entry.id)
    assert.deepEqual(f.novels.chapter(f.chapter.id), { ...original, version: original.version + 1 })
    assert.throws(() => f.novels.saveChapter(original.id, original.version, original.title, original.content), /版本|修改|冲突/)
    assert.deepEqual(f.planning.read(f.novel.id), { ...plan, version: plan.version + 1 })
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await f.close() }
})

test('writing, generated planning and read-only review share one budget without cross-module writes', { timeout: 10000 }, async () => {
  const f = await fixture(2)
  try {
    const before = f.novels.chapter(f.chapter.id), plan = f.planning.read(f.novel.id), bible = f.bible.list(f.novel.id)
    await f.generate()
    const writing = { action: 'continue', chapterId: f.chapter.id, before: '', after: '', selection: '', instructions: '', includeStoryContext: false, modelId: 'mock', parameters: defaultGeneration }
    assert.equal((await f.send('/ai/generate', writing)).status, 200)
    const input = { chapterId: f.chapter.id, chapterText: '云城允许飞行。', modelId: 'mock', parameters: defaultGeneration, context: { references: [], maxCharacters: 6000 } }
    const p = await f.send('/ai/review/preview', input); assert.equal(p.status, 200)
    const preview = await p.json() as ReviewPreview
    assert.equal((await f.send('/ai/review', { ...input, fingerprint: preview.fingerprint })).status, 429)
    assert.equal(f.calls(), 2)
    assert.deepEqual(f.novels.chapter(f.chapter.id), before); assert.deepEqual(f.planning.read(f.novel.id), plan); assert.deepEqual(f.bible.list(f.novel.id), bible)
  } finally { await f.close() }
})
