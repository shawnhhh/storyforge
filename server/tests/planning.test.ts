import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { emptyPlanning, type PlanningData, type PlanningSnapshot } from '../../shared/contracts/planning.js'
import type { Chapter } from '../../shared/contracts/novels.js'
import { createApp } from '../src/app.js'
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-planning-')), db = openDatabase(dir)
  const novels = new NovelStore(db), store = new PlanningStore(db)
  const novel = novels.create('第五阶段测试', '')
  const chapter = novels.createChapter(novel.id, novel.version, '第一章').chapter
  return { db, dir, novels, store, novel, chapter, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
export function sample(chapterId: string): PlanningData {
  return {
    outlines: [
      { id: 'overall', title: '总纲', content: '主角寻找真相', kind: 'overall', parentId: null, chapterIds: [] },
      { id: 'volume', title: '第一卷', content: '', kind: 'volume', parentId: 'overall', chapterIds: [] },
      { id: 'chapter', title: '初见', content: '大纲内容', kind: 'chapter', parentId: 'volume', chapterIds: [chapterId] },
    ],
    plotlines: [{ id: 'main', title: '主线', content: '', kind: 'main' }, { id: 'subplot', title: '支线', content: '', kind: 'subplot' }, { id: 'custom', title: '自定义线', content: '', kind: 'custom' }],
    cards: [
      { id: 'late', title: '归来', content: '详细内容', summary: '后发生', status: 'planned', plotlineId: 'main', storyTime: '三年后', timeOrder: 3, chapterIds: [chapterId] },
      { id: 'early', title: '出发', content: '', summary: '先发生', status: 'idea', plotlineId: 'subplot', storyTime: '元年', timeOrder: 1, chapterIds: [] },
    ],
    foreshadows: [{ id: 'hint', title: '失踪的信', content: '悬念', status: 'unplanted', chapterIds: [chapterId], plantedChapterIds: [], plannedChapterIds: [chapterId], resolvedChapterIds: [], cardIds: ['early', 'late'] }],
  }
}
test('planning CRUD, hierarchy and ordering persist independently without touching chapter text', () => {
  const f = fixture()
  try {
    const before = f.novels.chapter(f.chapter.id)
    assert.equal(f.store.read(f.novel.id).version, 0)
    let data = f.store.save(f.novel.id, 0, sample(f.chapter.id))
    assert.equal(data.version, 1)
    assert.deepEqual(data.cards.map(row => row.id), ['late', 'early'])
    assert.deepEqual([...data.cards].sort((a, b) => a.timeOrder! - b.timeOrder!).map(row => row.id), ['early', 'late'])
    data.outlines[2].parentId = 'overall'; data.outlines[2].title = '章节大纲已修改'
    data.cards.reverse(); data.plotlines.reverse()
    data = f.store.save(f.novel.id, data.version, data)
    const reopened = openDatabase(f.dir)
    try { assert.deepEqual(new PlanningStore(reopened).read(f.novel.id), data) } finally { reopened.close() }
    assert.equal(data.outlines[2].parentId, 'overall')
    assert.equal(data.cards[0].id, 'early')
    assert.deepEqual(f.novels.chapter(f.chapter.id), before)
    const cleared = f.store.save(f.novel.id, data.version, emptyPlanning())
    assert.equal(cleared.outlines.length, 0); assert.equal(cleared.foreshadows.length, 0)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM planning_chapter_links').get()!.n, 0)
  } finally { f.close() }
})
test('all foreshadow states and multiple card and chapter roles round trip', () => {
  const f = fixture()
  try {
    const nextChapter = f.novels.createChapter(f.novel.id, f.novels.novel(f.novel.id).version, '第二章').chapter
    let snapshot = f.store.save(f.novel.id, 0, sample(f.chapter.id))
    for (const status of ['unplanted', 'planted', 'advancing', 'resolved'] as const) {
      snapshot.foreshadows[0] = { ...snapshot.foreshadows[0], status, plantedChapterIds: [f.chapter.id], plannedChapterIds: [nextChapter.id], resolvedChapterIds: status === 'resolved' ? [nextChapter.id] : [], chapterIds: [f.chapter.id, nextChapter.id] }
      snapshot = f.store.save(f.novel.id, snapshot.version, snapshot)
      assert.equal(snapshot.foreshadows[0].status, status)
      assert.deepEqual(snapshot.foreshadows[0].cardIds, ['early', 'late'])
      assert.equal(snapshot.foreshadows[0].chapterIds.length, 2)
    }
    assert.equal(snapshot.foreshadows.filter(row => row.status !== 'resolved').length, 0)
  } finally { f.close() }
})
test('cycles, unknown parents, invalid statuses, duplicate IDs and dangling card links are rejected atomically', () => {
  const f = fixture()
  try {
    const saved = f.store.save(f.novel.id, 0, sample(f.chapter.id))
    const invalid = (mutate: (value: PlanningData) => void) => {
      const value = structuredClone(saved); mutate(value)
      assert.throws(() => f.store.save(f.novel.id, saved.version, value), (error: unknown) => error instanceof HttpError && error.status === 400)
      assert.deepEqual(f.store.read(f.novel.id), saved)
    }
    invalid(value => { value.outlines[0].parentId = 'chapter' })
    invalid(value => { value.outlines[0].parentId = 'missing' })
    invalid(value => { value.cards[0].status = 'invalid' as never })
    invalid(value => { value.cards[0].id = 'main' })
    invalid(value => { value.foreshadows[0].cardIds = ['missing'] })
    invalid(value => { value.cards[0].plotlineId = 'missing' })
    invalid(value => { value.cards[0].timeOrder = 0.5 })
    invalid(value => { value.outlines[0].title = '' })
  } finally { f.close() }
})
test('novels are isolated, cross-work chapter links are rejected at API and SQL levels', () => {
  const f = fixture()
  try {
    const other = f.novels.create('另一作品', '')
    const chapter = f.novels.createChapter(other.id, other.version, '其他章').chapter
    const data = f.store.save(f.novel.id, 0, sample(f.chapter.id))
    assert.equal(f.store.read(other.id).outlines.length, 0)
    assert.throws(() => f.store.save(other.id, 0, sample(f.chapter.id)), /属于其他作品/)
    assert.throws(() => f.db.prepare('INSERT INTO planning_chapter_links VALUES (?,?,?,?)').run(f.novel.id, data.outlines[0].id, chapter.id, 'chapterIds'), /another novel/)
    assert.throws(() => f.store.read('missing'), /不存在/)
    assert.deepEqual(f.store.read(f.novel.id), data)
    assert.equal(f.store.read(other.id).version, 0)
  } finally { f.close() }
})
test('stale planning writes and stale novel deletions fail; deleting a chapter removes links and invalidates drafts', () => {
  const f = fixture()
  const other = openDatabase(f.dir)
  try {
    const client = new PlanningStore(other), stale = client.read(f.novel.id)
    const oldNovel = f.novels.novel(f.novel.id)
    const data = f.store.save(f.novel.id, 0, sample(f.chapter.id))
    assert.throws(() => client.save(f.novel.id, stale.version, sample(f.chapter.id)), (error: unknown) => error instanceof HttpError && error.status === 409)
    assert.throws(() => f.novels.remove(f.novel.id, oldNovel.version), /更新/)
    f.novels.removeChapter(f.chapter.id, f.chapter.version, f.novels.novel(f.novel.id).version)
    const fresh = f.store.read(f.novel.id)
    assert.equal(fresh.version, data.version + 1)
    assert.deepEqual(fresh.outlines[2].chapterIds, [])
    assert.deepEqual(fresh.foreshadows[0].plannedChapterIds, [])
    assert.throws(() => client.save(f.novel.id, data.version, data), (error: unknown) => error instanceof HttpError && error.status === 409)
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM planning_records').get()!.n, 0)
  } finally { other.close(); f.close() }
})
test('a storage failure rolls back the planning workspace, records, chapter links and novel version', () => {
  const f = fixture()
  try {
    const data = f.store.save(f.novel.id, 0, sample(f.chapter.id)), before = f.novels.novel(f.novel.id)
    f.db.exec("CREATE TRIGGER planning_failure BEFORE UPDATE ON novels BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
    assert.throws(() => f.store.save(f.novel.id, data.version, emptyPlanning()), /disk failure/)
    assert.deepEqual(f.store.read(f.novel.id), data)
    assert.deepEqual(f.novels.novel(f.novel.id), before)
  } finally { f.close() }
})
test('planning HTTP validates inputs, preserves chapter content and includes planning in JSON export', { timeout: 12000 }, async () => {
  const f = fixture(), server = createApp(f.db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/novels/${f.novel.id}`
    const put = (value: unknown) => fetch(`${base}/planning`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(3000) })
    assert.equal((await put({ ...sample(f.chapter.id), version: 0 })).status, 200)
    assert.equal((await put({ ...sample(f.chapter.id), version: 0 })).status, 409)
    assert.equal((await put({ version: 1 })).status, 400)
    const data = await (await fetch(`${base}/planning`)).json() as PlanningSnapshot
    assert.equal(data.outlines[2].chapterIds[0], f.chapter.id)
    const exported = await (await fetch(`${base}/export?format=json`)).json() as { planning: PlanningSnapshot; chapters: Chapter[] }
    assert.deepEqual(exported.planning, data)
    assert.deepEqual(exported.chapters[0].content, f.chapter.content)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.close() }
})
