import { request as httpRequest } from 'node:http'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { TrashStore } from '../src/modules/trash/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { KnowledgeStore } from '../src/modules/story-bible/knowledge.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { DashboardStore } from '../src/modules/dashboard/store.js'
import { search } from '../src/modules/search/routes.js'
import { createApp } from '../src/app.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
const DAY = 86400000
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-trash-')), db = openDatabase(join(dir, 'data'))
  const novels = new NovelStore(db), profiles = new StoryBibleStore(db), knowledge = new KnowledgeStore(db), planning = new PlanningStore(db)
  const novel = novels.create('虚构回收站小说', '隔离测试'), first = novels.createChapter(novel.id, novel.version, '虚构第一章')
  const second = novels.createChapter(novel.id, first.novel.version, '虚构第二章')
  novels.saveChapter(first.chapter.id, first.chapter.version, first.chapter.title, { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '虚构安全正文' }] }] })
  const world = profiles.saveWorld(novel.id, { ...newWorld(), name: '虚构云城' })
  const target = profiles.saveCharacter(novel.id, { ...newCharacter(), name: '虚构配角' })
  const hero = profiles.saveCharacter(novel.id, { ...newCharacter(), name: '虚构主角', relations: [{ targetId: target.id, kind: '朋友' }], worldIds: [world.id] })
  knowledge.save(novel.id, 0, [{ id: 'ref', source: { kind: 'chapter', id: first.chapter.id }, target: { kind: 'character', id: target.id }, label: '出场', note: '虚构关联' }])
  const data = emptyPlanning()
  data.outlines = [{ id: 'parent', title: '虚构父大纲', content: '', kind: 'overall', parentId: null, chapterIds: [first.chapter.id] }, { id: 'child', title: '虚构子大纲', content: '', kind: 'chapter', parentId: 'parent', chapterIds: [] }]
  planning.save(novel.id, 0, data)
  const trash = new TrashStore(db)
  return { dir, db, novels, profiles, knowledge, planning, novel, first: first.chapter, second: second.chapter, hero, target, world, trash, close() { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}

test('trash: chapter deletion/restoration preserves prose, order, references, search and lifetime statistics', () => {
  const f = fixture()
  try {
    const history = f.db.prepare('SELECT * FROM writing_days').all()
    const chapter = f.novels.chapter(f.first.id)
    f.novels.removeChapter(chapter.id, chapter.version, f.novels.novel(f.novel.id).version)
    assert.equal(search(f.db, '虚构安全正文').hits.length, 0)
    assert.equal(new DashboardStore(f.db).read().totalWords, 0)
    assert.deepEqual(f.knowledge.read(f.novel.id).links, [])
    assert.deepEqual(f.planning.read(f.novel.id).outlines[0].chapterIds, [])
    assert.equal(f.novels.detail(f.novel.id).chapters[0].position, 0)
    const entry = f.trash.list()[0]
    assert.equal(entry.affected.knowledge_links, 1)
    f.trash.restore(String(entry.id), true)
    assert.deepEqual(f.novels.detail(f.novel.id).chapters.map(row => [row.id, row.position]), [[f.first.id, 0], [f.second.id, 1]])
    assert.deepEqual(f.novels.chapter(chapter.id).content, chapter.content)
    assert.equal(f.knowledge.read(f.novel.id).links[0].id, 'ref')
    assert.deepEqual(f.planning.read(f.novel.id).outlines[0].chapterIds, [chapter.id])
    assert.equal(search(f.db, '虚构安全正文').hits.length, 1)
    assert.equal(new DashboardStore(f.db).read().totalWords, 6)
    assert.deepEqual(f.db.prepare('SELECT * FROM writing_days').all(), history)
    assert.throws(() => f.novels.saveChapter(chapter.id, chapter.version, chapter.title, chapter.content), /另一个窗口/)
  } finally { f.close() }
})

test('trash: character deletion restores incoming relationships and references; missing targets block atomically', () => {
  const f = fixture()
  try {
    f.profiles.remove('characters', f.novel.id, f.target.id, f.target.version)
    const characterEntry = String(f.trash.list()[0].id)
    assert.deepEqual(f.profiles.list(f.novel.id).characters[0].relations, [])
    f.profiles.remove('characters', f.novel.id, f.hero.id, f.profiles.list(f.novel.id).characters[0].version)
    assert.throws(() => f.trash.restore(characterEntry, true), /恢复被阻止/)
    assert.equal(f.profiles.list(f.novel.id).characters.length, 0)
    assert.equal(f.trash.list().length, 2)
    // Restore the relationship owner first, then the target with the relationship.
    const heroEntry = f.trash.list().find(row => row.name === f.hero.name)!
    f.trash.restore(String(heroEntry.id), true)
    f.trash.restore(characterEntry, true)
    assert.deepEqual(f.profiles.list(f.novel.id).characters.find(row => row.id === f.hero.id)!.relations, f.hero.relations)
    assert.equal(f.knowledge.read(f.novel.id).links.length, 1)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.close() }
})

test('trash: world entries restore their character links and soft-deleted novels restore every module', () => {
  const f = fixture()
  try {
    f.profiles.remove('world', f.novel.id, f.world.id, f.world.version)
    const worldEntry = f.trash.list()[0]
    assert.deepEqual(f.profiles.list(f.novel.id).characters.find(row => row.id === f.hero.id)!.worldIds, [])
    f.trash.restore(String(worldEntry.id), true)
    assert.deepEqual(f.profiles.list(f.novel.id).characters.find(row => row.id === f.hero.id)!.worldIds, [f.world.id])
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    assert.equal(f.novels.list().length, 0)
    const entry = f.trash.list()[0]
    assert.equal(entry.affected.chapters, 2)
    f.trash.restore(String(entry.id), true)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 2)
    assert.equal(f.profiles.list(f.novel.id).characters.length, 2)
    assert.equal(f.profiles.list(f.novel.id).world.length, 1)
    assert.equal(f.knowledge.read(f.novel.id).links.length, 1)
    assert.equal(f.planning.read(f.novel.id).outlines.length, 2)
  } finally { f.close() }
})

test('trash: explicit relationship/reference removal is recoverable without overwriting profile edits', () => {
  const f = fixture()
  try {
    f.profiles.saveCharacter(f.novel.id, { ...f.hero, relations: [], fields: { ...f.hero.fields, notes: '保留新笔记' } }, f.hero.id, f.hero.version)
    let entry = f.trash.list()[0]
    assert.equal(entry.kind, 'relation')
    f.trash.restore(String(entry.id), true)
    const hero = f.profiles.list(f.novel.id).characters.find(row => row.id === f.hero.id)!
    assert.equal(hero.fields.notes, '保留新笔记'); assert.deepEqual(hero.relations, f.hero.relations)
    f.knowledge.save(f.novel.id, f.knowledge.read(f.novel.id).version, [])
    entry = f.trash.list()[0]
    assert.equal(entry.kind, 'reference')
    f.trash.restore(String(entry.id), true)
    assert.equal(f.knowledge.read(f.novel.id).links.length, 1)
  } finally { f.close() }
})

test('trash: planning removal restores hierarchy; modified dependants block restoration and roll back', () => {
  const f = fixture()
  try {
    const data = f.planning.read(f.novel.id)
    f.planning.save(f.novel.id, data.version, { ...data, outlines: [{ ...data.outlines[1], parentId: null }] })
    const entry = String(f.trash.list()[0].id)
    const changed = f.planning.read(f.novel.id)
    f.planning.save(f.novel.id, changed.version, { ...changed, outlines: [{ ...changed.outlines[0], content: '后续编辑' }] })
    assert.throws(() => f.trash.restore(entry, true), /规划已修改/)
    assert.equal(f.planning.read(f.novel.id).outlines.length, 1)
    const latest = f.planning.read(f.novel.id)
    f.planning.save(f.novel.id, latest.version, { ...latest, outlines: [{ ...latest.outlines[0], content: '' }] })
    f.trash.restore(entry, true)
    assert.equal(f.planning.read(f.novel.id).outlines.find(row => row.id === 'child')!.parentId, 'parent')
  } finally { f.close() }
})

test('trash: deletion and restoration roll back on injected SQLite faults', () => {
  const f = fixture()
  try {
    f.db.exec("CREATE TEMP TRIGGER fail_archive BEFORE INSERT ON main.trash_entries BEGIN SELECT RAISE(ABORT, 'archive fault'); END")
    assert.throws(() => f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version), /archive fault/)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 2)
    assert.equal(f.trash.list().length, 0)
    f.db.exec('DROP TRIGGER fail_archive')
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    const entry = String(f.trash.list()[0].id)
    f.db.exec("CREATE TEMP TRIGGER fail_restore BEFORE INSERT ON main.characters BEGIN SELECT RAISE(ABORT, 'restore fault'); END")
    assert.throws(() => f.trash.restore(entry, true), /恢复被阻止/)
    assert.equal(f.novels.list().length, 0); assert.equal(f.trash.list().length, 1)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
    f.db.exec('DROP TRIGGER fail_restore')
    f.trash.restore(entry, true)
  } finally { f.close() }
})

test('trash: parent purge protection, exact-name permanent deletion and double restore state checks', () => {
  const f = fixture()
  try {
    f.novels.removeChapter(f.first.id, f.first.version + 1, f.novels.novel(f.novel.id).version)
    const child = f.trash.list()[0]
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    const parent = f.trash.list().find(row => row.kind === 'novel')!
    assert.throws(() => f.trash.restore(String(child.id), true), /先恢复所属小说/)
    assert.throws(() => f.trash.purge(String(parent.id), true, parent.name), /其他回收站项目/)
    assert.throws(() => f.trash.purge(String(child.id), false, child.name), /确认/)
    assert.throws(() => f.trash.purge(String(child.id), true, String(child.name) + ' '), /完全匹配/)
    f.trash.purge(String(child.id), true, child.name)
    assert.throws(() => f.trash.restore(String(child.id), true), /不存在/)
    f.trash.purge(String(parent.id), true, parent.name)
    assert.equal(f.trash.list().length, 0)
  } finally { f.close() }
})

test('trash: 30-day boundary is exact, cleanup is transactional, idempotent and never deletes active data', () => {
  const f = fixture()
  try {
    f.novels.removeChapter(f.first.id, f.first.version + 1, f.novels.novel(f.novel.id).version)
    const entry = f.trash.list()[0], deleted = Date.parse(String(entry.deletedAt))
    assert.equal(Date.parse(String(entry.expiresAt)) - deleted, 30 * DAY)
    assert.equal(new TrashStore(f.db, () => deleted + 30 * DAY - 1).cleanup(), 0)
    const expired = new TrashStore(f.db, () => deleted + 30 * DAY)
    assert.throws(() => expired.restore(String(entry.id), true), /30 天/)
    f.db.exec("CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON main.trash_entries BEGIN SELECT RAISE(ABORT, 'cleanup fault'); END")
    assert.throws(() => expired.cleanup(), /cleanup fault/)
    assert.equal(f.trash.list().length, 1)
    f.db.exec('DROP TRIGGER fail_cleanup')
    assert.equal(expired.cleanup(), 1); assert.equal(expired.cleanup(), 0)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 1)
    assert.equal(f.profiles.list(f.novel.id).characters.length, 2)
  } finally { f.close() }
})

test('trash: backup/restore includes recycle contents atomically and preserved files can restore an archived novel', async () => {
  const f = fixture(), backups = new BackupService(f.db, join(f.dir, 'backups'))
  try {
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    const original = f.trash.list(), entry = await backups.create()
    f.trash.restore(String(original[0].id), true)
    let preparation = backups.prepare(entry.id)
    await assert.rejects(backups.restore(entry.id, preparation.token, '替换当前全部数据', () => { throw new Error('backup rollback') }), /backup rollback/)
    assert.equal(f.trash.list().length, 0); assert.equal(f.novels.list().length, 1)
    preparation = backups.prepare(entry.id)
    await backups.restore(entry.id, preparation.token, '替换当前全部数据')
    assert.deepEqual(f.trash.list(), original); assert.equal(f.novels.list().length, 0)
    f.trash.restore(String(original[0].id), true)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 2)
  } finally { await backups.stop(); f.close() }
})

test('trash HTTP: backend rejects missing confirmation, wrong name, foreign origin/host, stale state/generation and backup locks', async () => {
  const f = fixture(), backups = new BackupService(f.db, join(f.dir, 'backups'))
  const server = createApp(f.db, backups).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const url = `http://127.0.0.1:${address.port}/api`
    const send = (path: string, body: unknown, method = 'DELETE', headers = {}) => fetch(url + path, { method, headers: { 'Content-Type': 'application/json', 'X-StoryForge-Generation': backups.generation, ...headers }, body: JSON.stringify(body) })
    const body = { version: f.novels.novel(f.novel.id).version, confirmed: true, name: f.novel.title }
    assert.equal((await send(`/novels/${f.novel.id}`, { ...body, confirmed: false })).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}`, { ...body, name: f.novel.title + ' ' })).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}`, body, 'DELETE', { Origin: 'https://evil.example' })).status, 403)
    const hostileHost = await new Promise<number>(resolve => { const req = httpRequest(url + '/trash', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode!) }); req.end() })
    assert.equal(hostileHost, 403)
    assert.equal((await send(`/novels/${f.novel.id}`, { ...body, version: 1 })).status, 409)
    assert.equal((await send(`/novels/${f.novel.id}`, body)).status, 204)
    const id = String(f.trash.list()[0].id)
    assert.equal((await send(`/trash/${id}/restore`, {}, 'POST')).status, 400)
    assert.equal((await send(`/trash/${id}/restore`, { confirmed: true }, 'POST', { 'X-StoryForge-Generation': 'stale' })).status, 409)
    backups.busy = true
    assert.equal((await send(`/trash/${id}`, { confirmed: true, name: f.novel.title })).status, 423)
    backups.busy = false
    assert.equal((await send(`/trash/${id}/restore`, { confirmed: true }, 'POST')).status, 204)
    assert.equal((await send(`/trash/${id}/restore`, { confirmed: true }, 'POST')).status, 404)
  } finally { backups.busy = false; await new Promise<void>(resolve => server.close(() => resolve())); await backups.stop(); f.close() }
})

test('trash: migration from v4 is additive, repeatable and rolls back on a conflicting v5 table', async () => {
  const { DatabaseSync } = await import('node:sqlite')
  const { migrate } = await import('../src/db/migrate.js')
  const { migratePlanning } = await import('../src/db/planning-migrate.js')
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON'); migrate(db, 4); migratePlanning(db)
    const novels = new NovelStore(db), novel = novels.create('虚构 v4 迁移作品', '保留')
    novels.createChapter(novel.id, novel.version, '保留旧正文')
    const before = novels.exportData(novel.id)
    db.exec('CREATE TABLE trash_entries (unrelated TEXT)')
    assert.throws(() => migrate(db), /already exists/)
    assert.equal(db.prepare('SELECT max(version) AS n FROM schema_migrations').get()!.n, 4)
    assert.deepEqual(novels.exportData(novel.id), before)
    db.exec('DROP TABLE trash_entries'); migrate(db)
    const history = db.prepare('SELECT * FROM schema_migrations').all(); migrate(db)
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), history)
    assert.equal(history.length, 5); assert.deepEqual(novels.exportData(novel.id), before)
  } finally { db.close() }
})

test('trash: archived references protect their targets from purge, including unexpired dependent archives', () => {
  const f = fixture()
  try {
    f.knowledge.save(f.novel.id, 1, [])
    const reference = f.trash.list().find(row => row.kind === 'reference')!
    f.profiles.remove('characters', f.novel.id, f.target.id, f.target.version)
    const target = f.trash.list().find(row => row.name === f.target.name)!
    assert.throws(() => f.trash.purge(target.id, true, target.name), /关联目标/)
    const cutoff = Date.parse(target.expiresAt)
    f.db.prepare('UPDATE trash_entries SET deleted_at=?,expires_at=? WHERE id=?').run(new Date(cutoff - DAY).toISOString(), new Date(cutoff + 29 * DAY).toISOString(), reference.id)
    assert.equal(new TrashStore(f.db, () => cutoff).cleanup(), 0)
    assert.equal(f.trash.list().length, 2)
    f.trash.purge(reference.id, true, reference.name)
    assert.equal(new TrashStore(f.db, () => cutoff).cleanup(), 1)
    assert.equal(f.trash.list().length, 0)
  } finally { f.close() }
})

test('trash: invalid retention or corrupted archived prose fails closed and preserves active data', () => {
  const f = fixture()
  try {
    f.novels.removeChapter(f.first.id, f.first.version + 1, f.novels.novel(f.novel.id).version)
    const entry = f.trash.list()[0]
    assert.equal(f.trash.preview(entry.id).documents[0].text.trim(), '虚构安全正文')
    const payload = String(f.db.prepare('SELECT payload FROM trash_entries WHERE id=?').get(entry.id)!.payload)
    const corrupt = JSON.parse(payload); corrupt.rows.chapters[0].content = JSON.stringify({ type: 'unknown' })
    f.db.prepare('UPDATE trash_entries SET payload=? WHERE id=?').run(JSON.stringify(corrupt), entry.id)
    assert.throws(() => f.trash.restore(entry.id, true), /记录格式或正文无效/)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 1)
    f.db.prepare('UPDATE trash_entries SET payload=?,expires_at=? WHERE id=?').run(payload, new Date(Date.parse(entry.deletedAt) + DAY).toISOString(), entry.id)
    assert.throws(() => new TrashStore(f.db, () => Date.parse(entry.deletedAt) + 31 * DAY).cleanup(), /保留期限记录无效/)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM trash_entries').get()!.n, 1)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.close() }
})

test('trash HTTP: chapter, profile, relationship, reference and planning deletions require explicit confirmation', async () => {
  const f = fixture(), server = createApp(f.db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const root = `http://127.0.0.1:${address.port}/api`
    const send = (path: string, data: unknown, method = 'PUT') => fetch(root + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    assert.equal((await send(`/chapters/${f.first.id}`, { version: 2, novelVersion: f.novels.novel(f.novel.id).version }, 'DELETE')).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}/characters/${f.target.id}`, { version: 1 }, 'DELETE')).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}/world/${f.world.id}`, { version: 1 }, 'DELETE')).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}/characters/${f.hero.id}`, { ...f.hero, relations: [] })).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}/knowledge-links`, { version: 1, links: [] })).status, 400)
    const planning = f.planning.read(f.novel.id)
    assert.equal((await send(`/novels/${f.novel.id}/planning`, { ...planning, outlines: [] })).status, 400)
    assert.equal((await send(`/novels/${f.novel.id}/planning`, { ...planning, outlines: planning.outlines.map(row => ({ ...row, chapterIds: [] })) })).status, 400)
    assert.equal(f.trash.list().length, 0)
    assert.equal(f.novels.detail(f.novel.id).chapters.length, 2)
    assert.equal(f.knowledge.read(f.novel.id).links.length, 1)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.close() }
})

test('trash: a newly created planning object with the archived ID blocks restoration without replacing new content', () => {
  const f = fixture()
  try {
    const original = f.planning.read(f.novel.id)
    f.planning.save(f.novel.id, original.version, { ...original, outlines: [{ ...original.outlines[1], parentId: null }] })
    const entry = f.trash.list()[0], after = f.planning.read(f.novel.id)
    const current = f.planning.save(f.novel.id, after.version, { ...after, outlines: [...after.outlines, { ...original.outlines[0], content: '另一次新建内容必须保留', chapterIds: [] }] })
    assert.throws(() => f.trash.restore(entry.id, true), /对象已存在/)
    assert.deepEqual(f.planning.read(f.novel.id), current)
    assert.equal(f.trash.list().length, 1)
  } finally { f.close() }
})

test('trash: restoring a planning association preserves prose edited in the same deletion save', () => {
  const f = fixture()
  try {
    const original = f.planning.read(f.novel.id)
    f.planning.save(f.novel.id, original.version, { ...original, outlines: [{ ...original.outlines[1], title: '同次保存的新标题', content: '同次保存的新正文不可丢失', parentId: null }] })
    f.trash.restore(f.trash.list()[0].id, true)
    const child = f.planning.read(f.novel.id).outlines.find(row => row.id === 'child')!
    assert.equal(child.parentId, 'parent')
    assert.equal(child.title, '同次保存的新标题')
    assert.equal(child.content, '同次保存的新正文不可丢失')
  } finally { f.close() }
})
