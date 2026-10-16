import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { once } from 'node:events'
import { request as httpRequest } from 'node:http'
import { migrate } from '../src/db/migrate.js'
import { migratePlanning } from '../src/db/planning-migrate.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { search } from '../src/modules/search/routes.js'
import { createApp } from '../src/app.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { defaultPreferences, preferencesKey, readPreferences, writePreferences, validatePreferences } from '../../src/features/preferences/model.js'

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON'); migrate(db); migratePlanning(db)
  return { db, novels: new NovelStore(db), bible: new StoryBibleStore(db), planning: new PlanningStore(db) }
}
test('search covers every persisted domain, nested prose and all profile fields; preserves data and versions', () => {
  const { db, novels, bible, planning } = fixture()
  try {
    const novel = novels.create('星河小说', '共同关键词 abc'), other = novels.create('另一作品', '共同关键词')
    const chapter = novels.createChapter(novel.id, novel.version, '正文标题').chapter
    novels.saveChapter(chapter.id, 1, chapter.title, { type: 'doc', content: [{ type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: '共同关键词 ABC <script> & 🌕', marks: [{ type: 'bold' }] }] }] }] })
    const hero = newCharacter(); hero.fields.background = '共同关键词'; hero.fields.notes = '备注独有词'
    const mentor = bible.saveCharacter(novel.id, { ...newCharacter(), name: '导师' })
    bible.saveCharacter(novel.id, { ...hero, name: '主角', tags: ['标签独有词'], relations: [{ targetId: mentor.id, kind: '师徒关系独有词' }] })
    bible.saveWorld(novel.id, { ...newWorld(), name: '城池', description: '共同关键词', timeText: '时间独有词' })
    const data = emptyPlanning()
    data.outlines.push({ id: 'o', title: '总纲', content: '共同关键词', kind: 'overall', parentId: null, chapterIds: [] })
    data.plotlines.push({ id: 'p', title: '主线', content: '共同关键词', kind: 'main' })
    data.cards.push({ id: 'c', title: '卡片', content: '', summary: '共同关键词', storyTime: '规划时间词', status: 'idea', plotlineId: 'p', timeOrder: null, chapterIds: [] })
    data.foreshadows.push({ id: 'f', title: '伏笔', content: '共同关键词', status: 'unplanted', plantedChapterIds: [], plannedChapterIds: [], resolvedChapterIds: [], chapterIds: [], cardIds: [] })
    planning.save(novel.id, 0, data)
    const before = novels.exportData(novel.id), profiles = bible.list(novel.id), snapshot = planning.read(novel.id)
    const result = search(db, ' 共同关键词 ')
    assert.equal(result.hits.length, 9); assert.equal(result.hasMore, false)
    assert.equal(new Set(result.hits.map(hit => hit.kind)).size, 8)
    assert.equal(search(db, '共同关键词', '', novel.id).hits.length, 8)
    assert.equal(search(db, '共同关键词', 'novel', other.id).hits.length, 1)
    assert.equal(search(db, 'abc', 'chapter').hits[0].id, chapter.id)
    for (const term of ['备注独有词', '标签独有词', '时间独有词', '规划时间词', '师徒关系独有词', '地点', '<script>', '🌕']) assert.equal(search(db, term).hits.length, 1)
    // JSON keys / rich text node names are implementation details, not searchable prose.
    for (const term of ['blockquote', 'background', 'bold']) assert.equal(search(db, term).hits.length, 0)
    assert.deepEqual(novels.exportData(novel.id), before); assert.deepEqual(bible.list(novel.id), profiles); assert.deepEqual(planning.read(novel.id), snapshot)
    const changed = novels.update(novel.id, novels.novel(novel.id).version, '新标题', '')
    assert.equal(search(db, '共同关键词', 'novel', novel.id).hits.length, 0)
    novels.remove(novel.id, changed.version)
    assert.deepEqual(search(db, '共同关键词', '', novel.id).hits, [])
  } finally { db.close() }
})
test('search is literal, bounded, deterministic, paginated and rejects invalid input', () => {
  const { db, novels } = fixture()
  try {
    for (let i = 0; i < 56; i++) novels.create(`分页 ${String(i).padStart(2, '0')}`, i === 0 ? "百分号 %_ ' OR 1=1 --" : '不匹配正文')
    const first = search(db, '分页'), second = search(db, '分页', '', '', '50')
    assert.equal(first.hits.length, 50); assert.equal(first.hasMore, true); assert.equal(second.hits.length, 6); assert.equal(second.hasMore, false)
    assert.equal(new Set([...first.hits, ...second.hits].map(hit => hit.id)).size, 56)
    assert.deepEqual(search(db, '分页'), first)
    assert.equal(search(db, '%_').hits.length, 1); assert.equal(search(db, "' OR 1=1 --").hits.length, 1)
    assert.deepEqual(search(db, '   '), { hits: [], hasMore: false })
    assert.equal(search(db, '不匹配正文', '', '', '999999').hits.length, 0)
    for (const args of [[undefined], [['x']], ['x'.repeat(201)], ['x', 'toString'], ['x', 'bad'], ['x', '', []], ['x', '', '', '-1'], ['x', '', '', '1.1'], ['x', '', '', '1000000']]) {
      assert.throws(() => search(db, args[0], args[1], args[2], args[3]), (error: unknown) => error instanceof HttpError && error.status === 400)
    }
  } finally { db.close() }
})
test('prose search joins inline formatting without inserting spaces and separates blocks', () => {
  const { db, novels } = fixture()
  try {
    const novel = novels.create('格式化正文', '')
    const chapter = novels.createChapter(novel.id, novel.version, '正文').chapter
    novels.saveChapter(chapter.id, 1, chapter.title, { type: 'doc', content: [
      { type: 'paragraph', content: [{ type: 'text', text: '魔' }, { type: 'text', text: '法', marks: [{ type: 'bold' }] }, { type: 'text', text: '城堡' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '下一段' }, { type: 'hardBreak' }, { type: 'text', text: '换行' }] },
    ] })
    for (const query of ['魔法城堡', '城堡 下一段', '下一段 换行']) assert.equal(search(db, query, 'chapter').hits[0]?.id, chapter.id)
    assert.equal(search(db, 'bold').hits.length, 0)
  } finally { db.close() }
})
test('search HTTP validates arrays, protects local host and does not cache content', async () => {
  const { db, novels } = fixture()
  const server = createApp(db).listen(0, '127.0.0.1')
  try {
    await once(server, 'listening')
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/search`
    novels.create('HTTP 搜索', '隔离内存数据库')
    const response = await fetch(base + '?q=HTTP')
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await response.json() as { hits: unknown[] }).hits.length, 1)
    for (const query of ['', '?q=a&q=b', '?q=x&kind[]=chapter', '?q=x&offset=NaN']) assert.equal((await fetch(base + query)).status, 400)
    // Node's fetch normalizes Host; use HTTP directly to exercise DNS-rebinding protection.
    const rejected = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(base + '?q=HTTP', { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode) })
      request.on('error', reject); request.end()
    })
    assert.equal(rejected, 403)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); db.close() }
})
test('preferences use mock storage, validate each field and leave drafts untouched', () => {
  const values = new Map<string, string>([['storyforge:planning-draft:novel', 'original draft']])
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } }
  assert.deepEqual(readPreferences(storage), defaultPreferences)
  const value = { theme: 'dark', font: 'mono', fontSize: 24, layout: 'wide', shortcutHints: false } as const
  writePreferences(storage, value); assert.deepEqual(readPreferences(storage), value)
  assert.equal(values.get('storyforge:planning-draft:novel'), 'original draft')
  assert.deepEqual(validatePreferences({ theme: 'unknown', font: 'url(bad)', fontSize: 100, layout: 'broken', shortcutHints: 'false' }), defaultPreferences)
  assert.deepEqual(validatePreferences({ theme: ['dark'], font: ['mono'], layout: ['wide'] }), defaultPreferences)
  for (const fontSize of [11, 29, 17.5, '20', null, NaN]) assert.equal(validatePreferences({ fontSize }).fontSize, 17)
  values.set(preferencesKey, '{invalid'); assert.throws(() => readPreferences(storage))
  const denied = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('quota') } }
  assert.throws(() => readPreferences(denied), /denied/); assert.throws(() => writePreferences(denied, value), /quota/)
})
