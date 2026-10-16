import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { DashboardStore, writingHistory } from '../src/modules/dashboard/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { countDocument } from '../../shared/domain/word-count.js'
import type { RichTextDocument } from '../../shared/contracts/novels.js'

const prose = (text: string): RichTextDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
function fixture() {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON'); migrate(db)
  return { db, novels: new NovelStore(db), dashboard: new DashboardStore(db) }
}
test('dashboard counts nested prose with the editor rules, empty works and recent chapters', () => {
  const f = fixture()
  try {
    assert.equal(f.dashboard.read().dailyGoal, 2000)
    assert.deepEqual(f.dashboard.read().novels, [])
    const novel = f.novels.create('虚构作品', '隔离数据'), empty = f.novels.create('空作品', '')
    const first = f.novels.createChapter(novel.id, novel.version, '开篇')
    f.novels.createChapter(novel.id, first.novel.version, '空章节')
    const doc: RichTextDocument = { type: 'doc', content: [
      { type: 'heading', content: [{ type: 'text', text: '第一幕' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }, { type: 'hardBreak' }, { type: 'text', text: 'world 2026' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'next' }] },
    ] }
    assert.equal(countDocument(doc), 7)
    f.novels.saveChapter(first.chapter.id, 1, '最近编辑', doc)
    // Give the untouched chapter a distinct timestamp; same-millisecond saves
    // deliberately use the API's deterministic id tie-breaker.
    f.db.prepare("UPDATE chapters SET updated_at='2000-01-01T00:00:00.000Z' WHERE id<>?").run(first.chapter.id)
    const data = f.dashboard.read(), item = data.novels.find(row => row.novel.id === novel.id)!
    assert.equal(data.totalWords, 7); assert.equal(data.totalChapters, 2); assert.equal(data.writtenChapters, 1)
    assert.equal(item.continueChapterId, first.chapter.id); assert.equal(item.words, 7)
    assert.equal(data.novels.find(row => row.novel.id === empty.id)!.chapters, 0)
    assert.equal(data.recent[0].title, '最近编辑'); assert.equal(data.days.length, 14)
    assert.ok(!('content' in data.recent[0]))
    f.novels.remove(novel.id, f.novels.novel(novel.id).version)
    assert.equal(f.dashboard.read().totalWords, 0); assert.equal(f.dashboard.read().recent.length, 0)
    assert.equal(f.dashboard.read().todayWords, 7) // Historical work survives deletion.
  } finally { f.db.close() }
})
test('daily additions count only committed growth; title/format edits, stale writes and failed transactions add nothing', () => {
  const f = fixture()
  try {
    const novel = f.novels.create('测试', ''), created = f.novels.createChapter(novel.id, 1, '一').chapter
    let saved = f.novels.saveChapter(created.id, 1, '一', prose('中文 hello'))
    assert.equal(f.dashboard.read().todayWords, 3)
    saved = f.novels.saveChapter(created.id, saved.chapter.version, '重命名', prose('中文 hello'))
    const formatted = prose('中文 hello'); formatted.content![0].content![0].marks = [{ type: 'bold' }]
    saved = f.novels.saveChapter(created.id, saved.chapter.version, '重命名', formatted)
    saved = f.novels.saveChapter(created.id, saved.chapter.version, '重命名', prose('中'))
    assert.equal(f.dashboard.read().todayWords, 3)
    assert.throws(() => f.novels.saveChapter(created.id, 1, '过期', prose('更多中文内容')), /另一个窗口/)
    f.db.exec("CREATE TRIGGER fail_touch BEFORE UPDATE ON novels BEGIN SELECT RAISE(ABORT, 'injected failure'); END")
    assert.throws(() => f.novels.saveChapter(created.id, saved.chapter.version, '失败', prose('更多中文内容')), /injected failure/)
    assert.equal(f.dashboard.read().todayWords, 3); assert.equal(f.dashboard.read().totalWords, 1)
    f.db.exec('DROP TRIGGER fail_touch')
    f.novels.saveChapter(created.id, saved.chapter.version, '成功', prose('中文'))
    assert.equal(f.dashboard.read().todayWords, 4)
  } finally { f.db.close() }
})
test('UTC streaks handle yesterday, gaps, month/year rollover, leap days and future records', () => {
  const history = ['2024-02-28', '2024-02-29', '2024-03-01', '2024-03-03'].map(day => ({ day, words: 1 }))
  assert.equal(writingHistory(history, '2024-03-01').streak, 3)
  assert.equal(writingHistory(history, '2024-03-02').streak, 3)
  assert.equal(writingHistory(history, '2024-03-03').streak, 1)
  assert.equal(writingHistory(history, '2024-03-05').streak, 0)
  assert.equal(writingHistory(history, '2024-03-05').longestStreak, 3)
  const year = writingHistory([{ day: '2025-12-31', words: 2 }, { day: '2026-01-01', words: 3 }], '2026-01-01')
  assert.equal(year.streak, 2); assert.equal(year.days.at(-1)!.words, 3)
  assert.deepEqual(writingHistory([], '2026-01-01').days.map(day => day.words), Array(14).fill(0))
})
test('v2 migration preserves exact chapter data without inventing activity and rolls back conflicts', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, 2)
    const novels = new NovelStore(db), novel = novels.create('旧小说', ''), chapter = novels.createChapter(novel.id, 1, '一').chapter
    novels.saveChapter(chapter.id, 1, '一', prose('旧正文'))
    const before = novels.exportData(novel.id)
    db.exec('CREATE TABLE writing_settings (legacy TEXT)')
    assert.throws(() => migrate(db), /already exists/)
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='writing_days'").get()!.n, 0)
    assert.deepEqual(novels.exportData(novel.id), before)
    db.exec('DROP TABLE writing_settings'); migrate(db); migrate(db)
    assert.deepEqual(novels.exportData(novel.id), before)
    assert.equal(new DashboardStore(db).read().todayWords, 0)
    assert.equal(new DashboardStore(db).read().totalWords, 3)
  } finally { db.close() }
})
test('goal, activity and chapter data persist and restore together, including rollback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-dashboard-'))
  let db = openDatabase(join(dir, 'data'))
  let service: BackupService | undefined
  try {
    let dashboard = new DashboardStore(db), novels = new NovelStore(db)
    const novel = novels.create('备份测试', ''), chapter = novels.createChapter(novel.id, 1, '一').chapter
    novels.saveChapter(chapter.id, 1, '一', prose('测试正文')); dashboard.setGoal(1200)
    db.close(); db = openDatabase(join(dir, 'data')); dashboard = new DashboardStore(db); novels = new NovelStore(db)
    const original = dashboard.read(); assert.equal(original.dailyGoal, 1200); assert.equal(original.todayWords, 4)
    service = new BackupService(db, join(dir, 'backups')); const target = await service.create()
    dashboard.setGoal(500); novels.saveChapter(chapter.id, 2, '二', prose('测试正文新增'))
    const changed = dashboard.read(), first = service.prepare(target.id)
    await assert.rejects(service.restore(target.id, first.token, '替换当前全部数据', () => { throw new Error('rollback') }), /rollback/)
    assert.deepEqual(dashboard.read(), changed)
    const next = service.prepare(target.id); await service.restore(target.id, next.token, '替换当前全部数据')
    assert.deepEqual(dashboard.read(), original)
  } finally { await service?.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
test('dashboard API validates goal range and type and preserves common origin protection', async () => {
  const f = fixture(), app = createApp(f.db), server = app.listen(0, '127.0.0.1')
  await new Promise<void>(resolve => server.once('listening', resolve))
  try {
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/dashboard`
    const write = (dailyGoal: unknown, origin?: string) => fetch(base + '/goal', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ dailyGoal }) })
    assert.equal((await fetch(base)).status, 200)
    for (const value of [0, -1, 1.5, '2000', null, 1000001]) assert.equal((await write(value)).status, 400)
    assert.equal((await write(3000, 'https://example.com')).status, 403)
    assert.equal(f.dashboard.read().dailyGoal, 2000)
    assert.equal((await write(3000)).status, 200); assert.equal(f.dashboard.read().dailyGoal, 3000)
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); f.db.close() }
})
