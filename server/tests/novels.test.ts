import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db/database.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'

const document = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一段故事', marks: [{ type: 'bold' }] }] }] }
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-test-'))
  const db = openDatabase(dir)
  return { dir, db, store: new NovelStore(db), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const conflict = (error: unknown) => error instanceof HttpError && error.status === 409

test('migration preserves pre-existing data and runs once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-migration-'))
  const previous = new DatabaseSync(join(dir, 'storyforge.sqlite'))
  previous.exec("CREATE TABLE legacy_notes (body TEXT); INSERT INTO legacy_notes VALUES ('不要删除');")
  previous.close()
  let db = openDatabase(dir)
  assert.equal(db.prepare('SELECT body FROM legacy_notes').get()!.body, '不要删除')
  const store = new NovelStore(db)
  const novel = store.create('保留的小说', '')
  db.close()
  db = openDatabase(dir)
  assert.equal(new NovelStore(db).novel(novel.id).title, '保留的小说')
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 1)
  assert.equal(db.prepare('SELECT body FROM legacy_notes').get()!.body, '不要删除')
  db.close(); rmSync(dir, { recursive: true, force: true })
})
test('novel and chapter CRUD, ordering, persistent reopen and cascade deletion', () => {
  const f = fixture()
  try {
    let novel = f.store.create('星海', '原创科幻')
    novel = f.store.update(novel.id, novel.version, '星海纪事', '新版简介')
    const first = f.store.createChapter(novel.id, novel.version, '起点')
    const second = f.store.createChapter(novel.id, first.novel.version, '远航')
    const saved = f.store.saveChapter(first.chapter.id, first.chapter.version, '第一章', document)
    assert.deepEqual(f.store.chapter(first.chapter.id).content, document)
    const ordered = f.store.reorder(novel.id, saved.novel.version, [second.chapter.id, first.chapter.id])
    assert.deepEqual(ordered.chapters.map(row => row.id), [second.chapter.id, first.chapter.id])
    const another = openDatabase(f.dir)
    assert.equal(new NovelStore(another).novel(novel.id).title, '星海纪事')
    assert.deepEqual(new NovelStore(another).chapter(first.chapter.id).content, document)
    another.close()
    const removed = f.store.removeChapter(second.chapter.id, second.chapter.version, ordered.novel.version)
    assert.equal(removed.chapters.length, 1)
    assert.equal(removed.chapters[0].position, 0)
    f.store.remove(novel.id, removed.novel.version)
    assert.equal(f.store.list().length, 0)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM chapters').get()!.count, 0)
  } finally { f.cleanup() }
})
test('two clients cannot overwrite content or delete/reorder using stale versions', () => {
  const f = fixture()
  try {
    const novel = f.store.create('并发小说', '')
    const created = f.store.createChapter(novel.id, novel.version, '一')
    const safari = f.store.chapter(created.chapter.id)
    const chrome = f.store.chapter(created.chapter.id)
    const saved = f.store.saveChapter(safari.id, safari.version, 'Safari 保存', document)
    assert.throws(() => f.store.saveChapter(chrome.id, chrome.version, 'Chrome 旧稿', { type: 'doc' }), conflict)
    assert.equal(f.store.chapter(chrome.id).title, 'Safari 保存')
    assert.throws(() => f.store.remove(novel.id, created.novel.version), conflict)
    assert.throws(() => f.store.reorder(novel.id, created.novel.version, [chrome.id]), conflict)
    assert.throws(() => f.store.removeChapter(chrome.id, chrome.version, saved.novel.version), conflict)
    assert.throws(() => f.store.update(novel.id, novel.version, '旧设置', ''), conflict)
    const fresh = f.store.chapter(chrome.id)
    assert.equal(f.store.saveChapter(fresh.id, fresh.version, 'Chrome 新版', document).chapter.version, fresh.version + 1)
  } finally { f.cleanup() }
})
test('invalid chapter order rolls back without bumping the novel version', () => {
  const f = fixture()
  try {
    const novel = f.store.create('排序', '')
    const created = f.store.createChapter(novel.id, novel.version, '一')
    assert.throws(() => f.store.reorder(novel.id, created.novel.version, ['other-novel-chapter']), (error: unknown) => error instanceof HttpError && error.status === 400)
    assert.equal(f.store.novel(novel.id).version, created.novel.version)
    assert.equal(f.store.detail(novel.id).chapters[0].id, created.chapter.id)
  } finally { f.cleanup() }
})
test('a failed migration rolls back and leaves existing conflicting tables untouched', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-migration-failure-'))
  let db = new DatabaseSync(join(dir, 'storyforge.sqlite'))
  db.exec("CREATE TABLE novels (original TEXT); INSERT INTO novels VALUES ('旧数据');")
  db.close()
  assert.throws(() => openDatabase(dir))
  db = new DatabaseSync(join(dir, 'storyforge.sqlite'))
  assert.equal(db.prepare('SELECT original FROM novels').get()!.original, '旧数据')
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='schema_migrations'").get()!.count, 0)
  db.close(); rmSync(dir, { recursive: true, force: true })
})

test('independent SQLite connections protect aggregate versions while allowing different chapters to save', () => {
  const f = fixture()
  const other = openDatabase(f.dir)
  try {
    const client = new NovelStore(other)
    const novel = f.store.create('连接隔离测试', '')
    const first = f.store.createChapter(novel.id, novel.version, '一')
    const second = f.store.createChapter(novel.id, first.novel.version, '二')
    const saved = client.saveChapter(first.chapter.id, first.chapter.version, '另一连接写入', document)
    assert.throws(() => f.store.removeChapter(second.chapter.id, second.chapter.version, second.novel.version), conflict)
    assert.throws(() => f.store.createChapter(novel.id, second.novel.version, '过期创建'), conflict)
    assert.throws(() => f.store.saveChapter(first.chapter.id, first.chapter.version, '过期正文', document), conflict)
    assert.equal(f.store.detail(novel.id).chapters.length, 2)
    const independent = f.store.saveChapter(second.chapter.id, second.chapter.version, '另一章节写入', document)
    assert.equal(independent.novel.version, saved.novel.version + 1)
    assert.equal(client.chapter(first.chapter.id).title, '另一连接写入')
  } finally { other.close(); f.cleanup() }
})

test('a persistence failure rolls back both chapter data and aggregate version', () => {
  const f = fixture()
  try {
    const novel = f.store.create('回滚测试', '')
    const created = f.store.createChapter(novel.id, novel.version, '原始章节')
    f.db.exec("CREATE TRIGGER fail_novel_update BEFORE UPDATE ON novels BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END")
    assert.throws(() => f.store.saveChapter(created.chapter.id, created.chapter.version, '失败写入', document), /simulated write failure/)
    assert.deepEqual(f.store.chapter(created.chapter.id), created.chapter)
    assert.deepEqual(f.store.novel(novel.id), created.novel)
    f.db.exec('DROP TRIGGER fail_novel_update')
    assert.equal(f.store.saveChapter(created.chapter.id, created.chapter.version, '恢复写入', document).chapter.version, 2)
  } finally { f.cleanup() }
})

test('a newer schema is refused without changing existing data or migrations', () => {
  const f = fixture()
  try {
    const novel = f.store.create('未来版本数据', '')
    f.db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString())
    assert.throws(() => openDatabase(f.dir), /newer/)
    assert.equal(f.store.novel(novel.id).title, novel.title)
    assert.equal(f.db.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()!.count, 2)
  } finally { f.cleanup() }
})
