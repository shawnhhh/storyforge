import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { createApp } from '../src/app.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-bible-test-'))
  const db = openDatabase(join(dir, 'data'))
  return { dir, db, novels: new NovelStore(db), store: new StoryBibleStore(db), cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const status = (code: number) => (error: unknown) => error instanceof HttpError && error.status === code
const prose = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '不得更改的小说正文 " \\ <&> 🌕\n第二行' }] }] }

test('v1 to v2 migration is additive, idempotent and preserves every original novel/chapter value', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-v1-upgrade-'))
  let db = new DatabaseSync(join(dir, 'storyforge.sqlite'))
  try {
    migrate(db, 1)
    const old = new NovelStore(db), novel = old.create('旧小说 中文🌕', '<&>')
    const created = old.createChapter(novel.id, novel.version, '旧章节')
    old.saveChapter(created.chapter.id, 1, '旧章节', prose)
    const before = old.exportData(novel.id), migrations = db.prepare('SELECT * FROM schema_migrations').all()
    db.close(); db = openDatabase(dir)
    assert.deepEqual(new NovelStore(db).exportData(novel.id), before)
    assert.deepEqual(db.prepare('SELECT * FROM schema_migrations WHERE version=1').all(), migrations)
    assert.deepEqual(new StoryBibleStore(db).list(novel.id), { characters: [], world: [] })
    const after = db.prepare('SELECT * FROM schema_migrations').all()
    migrate(db); assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), after)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('failed v2 migration rolls back all new tables and keeps v1 data intact', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db, 1)
    const store = new NovelStore(db), novel = store.create('保留原文', '')
    db.exec("CREATE TABLE world_entries(original TEXT); INSERT INTO world_entries VALUES ('旧资料')")
    assert.throws(() => migrate(db))
    assert.equal(store.novel(novel.id).title, '保留原文')
    assert.equal(db.prepare('SELECT original FROM world_entries').get()!.original, '旧资料')
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='characters'").get()!.n, 0)
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()!.n, 1)
  } finally { db.close() }
})

test('profile CRUD persists Unicode, custom categories, tags, directed relationships and world links without touching prose', () => {
  const f = fixture()
  try {
    const novel = f.novels.create('故事🌕', '')
    const chapter = f.novels.createChapter(novel.id, novel.version, '正文')
    f.novels.saveChapter(chapter.chapter.id, 1, '正文', prose)
    const before = f.novels.exportData(novel.id)
    const setting = f.store.saveWorld(novel.id, { ...newWorld('history'), name: '云城 <&>', tags: ['组织🌕'], description: '中文\n" \\ <&>', timeText: '上古·冬', sortOrder: -5 })
    let hero = f.store.saveCharacter(novel.id, { ...newCharacter(), name: '林月🌕', category: '自定义角色', tags: ['标签<&>'], fields: Object.fromEntries(Object.keys(newCharacter().fields).map(key => [key, `${key} 中文\n" \\ <&>🌕`])) })
    const mentor = f.store.saveCharacter(novel.id, { ...newCharacter(), name: '师父' })
    hero = f.store.saveCharacter(novel.id, { ...hero, relations: [{ targetId: mentor.id, kind: '师徒🌕' }], worldIds: [setting.id] }, hero.id, hero.version)
    const saved = f.store.list(novel.id)
    // Equal-millisecond creation times are ordered by UUID, not insertion order.
    assert.deepEqual(saved.characters.find(row => row.id === hero.id), hero)
    assert.deepEqual(saved.world, [setting])
    assert.deepEqual(saved.characters.find(row => row.id === mentor.id)!.relations, [])
    const other = openDatabase(join(f.dir, 'data'))
    try { assert.deepEqual(new StoryBibleStore(other).list(novel.id), saved) } finally { other.close() }
    assert.throws(() => f.store.saveCharacter(novel.id, { ...hero, name: '覆盖旧稿' }, hero.id, 1), status(409))
    assert.throws(() => f.store.remove('world', novel.id, setting.id, 999), status(409))
    const changed = f.store.saveWorld(novel.id, { ...setting, description: '新版本' }, setting.id, setting.version)
    assert.equal(changed.version, 2)
    f.store.remove('characters', novel.id, mentor.id, mentor.version)
    const cleaned = f.store.list(novel.id).characters[0]
    assert.deepEqual(cleaned.relations, []); assert.equal(cleaned.version, hero.version + 1)
    assert.throws(() => f.store.saveCharacter(novel.id, hero, hero.id, hero.version), status(409))
    f.store.remove('world', novel.id, setting.id, changed.version)
    const unlinked = f.store.list(novel.id).characters[0]
    assert.deepEqual(unlinked.worldIds, []); assert.equal(unlinked.version, cleaned.version + 1)
    assert.deepEqual(f.novels.exportData(novel.id), before)
    f.novels.remove(novel.id, before.novel.version)
    for (const table of ['characters', 'world_entries', 'character_relations', 'character_world_links']) assert.equal(f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n, 0)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.cleanup() }
})

test('cross-novel and invalid associations roll back, and SQLite itself enforces same-novel foreign keys', () => {
  const f = fixture()
  try {
    const a = f.novels.create('甲', ''), b = f.novels.create('乙', '')
    const hero = f.store.saveCharacter(a.id, newCharacter()), other = f.store.saveCharacter(b.id, newCharacter())
    const location = f.store.saveWorld(b.id, newWorld())
    assert.deepEqual(f.store.list(a.id).world, [])
    for (const patch of [{ relations: [{ targetId: other.id, kind: '朋友' }] }, { relations: [{ targetId: hero.id, kind: '自己' }] }, { relations: [{ targetId: 'missing', kind: '朋友' }] }, { worldIds: [location.id] }]) {
      assert.throws(() => f.store.saveCharacter(a.id, { ...hero, name: '不应保存', ...patch }, hero.id, hero.version), status(400))
      assert.deepEqual(f.store.list(a.id).characters[0], hero)
    }
    assert.throws(() => f.store.saveCharacter(b.id, hero, hero.id, 1), status(404))
    assert.throws(() => f.store.remove('characters', b.id, hero.id, 1), status(404))
    assert.throws(() => f.db.prepare('INSERT INTO character_relations VALUES (?,?,?,?)').run(a.id, hero.id, other.id, '朋友'), /FOREIGN KEY/)
    assert.throws(() => f.db.prepare('INSERT INTO character_world_links VALUES (?,?,?)').run(a.id, hero.id, location.id), /FOREIGN KEY/)
    for (const patch of [{ name: ' ' }, { tags: ['重复', '重复'] }, { fields: {} }, { relations: [{ targetId: other.id, kind: '' }] }, { worldIds: ['x', 'x'] }]) assert.throws(() => f.store.saveCharacter(a.id, { ...hero, ...patch }, hero.id, 1), status(400))
    for (const patch of [{ category: '__proto__' }, { sortOrder: 1.5 }, { onTimeline: 1 }, { name: '' }, { tags: [12] }]) assert.throws(() => f.store.saveWorld(a.id, { ...newWorld(), ...patch }), status(400))
    assert.deepEqual(f.store.list(a.id).characters[0], hero)
  } finally { f.cleanup() }
})

test('v2 backup restores all profile rows and associations atomically; injected failure rolls back profiles too', async () => {
  const f = fixture(), service = new BackupService(f.db, join(f.dir, 'backups'))
  try {
    const novel = f.novels.create('备份作品', '')
    const target = f.store.saveCharacter(novel.id, newCharacter()), location = f.store.saveWorld(novel.id, newWorld())
    f.store.saveCharacter(novel.id, { ...newCharacter(), name: '关联人物', relations: [{ targetId: target.id, kind: '亲属' }], worldIds: [location.id] })
    const before = f.store.list(novel.id), backup = await service.create()
    assert.equal(backup.schemaVersion, 2)
    f.store.remove('world', novel.id, location.id, 1)
    const modified = f.store.list(novel.id), prepared = service.prepare(backup.id)
    await assert.rejects(service.restore(backup.id, prepared.token, '替换当前全部数据', () => { throw new Error('profile rollback') }), /profile rollback/)
    assert.deepEqual(f.store.list(novel.id), modified)
    const again = service.prepare(backup.id)
    await service.restore(backup.id, again.token, '替换当前全部数据')
    assert.deepEqual(f.store.list(novel.id), before)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await service.stop(); f.cleanup() }
})

test('v1 history restores through a private v2 stage, preserves original backup bytes and keeps new profiles in the safety backup', async () => {
  const f = fixture(), service = new BackupService(f.db, join(f.dir, 'backups'))
  try {
    const createdAt = new Date().toISOString(), id = `storyforge-${createdAt.replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`
    const path = join(service.directory, id), legacy = new DatabaseSync(path)
    let oldData
    try {
      migrate(legacy, 1)
      const store = new NovelStore(legacy), novel = store.create('旧备份小说🌕', '')
      const chapter = store.createChapter(novel.id, 1, '旧正文')
      store.saveChapter(chapter.chapter.id, 1, '旧正文', prose)
      oldData = store.exportData(novel.id)
      legacy.exec('PRAGMA journal_mode=DELETE')
    } finally { legacy.close() }
    const original = readFileSync(path), metadata = { id, createdAt, schemaVersion: 1, kind: 'manual', size: statSync(path).size, sha256: createHash('sha256').update(original).digest('hex') }
    writeFileSync(path + '.json', JSON.stringify(metadata))
    const currentNovel = f.novels.create('恢复前新作品', '')
    f.store.saveCharacter(currentNovel.id, newCharacter())
    const current = f.store.list(currentNovel.id)
    assert.equal(service.verify(id).schemaVersion, 1)
    const prepared = service.prepare(id), result = await service.restore(id, prepared.token, '替换当前全部数据')
    assert.deepEqual(f.novels.exportData(oldData.novel.id), oldData)
    assert.deepEqual(f.store.list(oldData.novel.id), { characters: [], world: [] })
    assert.equal(f.db.prepare('SELECT MAX(version) AS n FROM schema_migrations').get()!.n, 2)
    assert.deepEqual(readFileSync(path), original)
    assert.equal(service.verify(id).schemaVersion, 1)
    const safety = new DatabaseSync(join(service.directory, result.safety.id), { readOnly: true })
    try { assert.deepEqual(new StoryBibleStore(safety).list(currentNovel.id), current) } finally { safety.close() }
  } finally { await service.stop(); f.cleanup() }
})

test('HTTP profile APIs validate inputs, enforce scope and versions, and reject writes during backups or after restore', async () => {
  const f = fixture(), backups = new BackupService(f.db, join(f.dir, 'backups'))
  const server = createApp(f.db, backups).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api`, generation = backups.generation
    const request = (path: string, method = 'GET', body?: unknown) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-StoryForge-Generation': generation }, body: body === undefined ? undefined : JSON.stringify(body) })
    const a = f.novels.create('HTTP甲', ''), b = f.novels.create('HTTP乙', '')
    const root = `/novels/${a.id}`, response = await request(root + '/characters', 'POST', { ...newCharacter(), name: '接口人物🌕' })
    assert.equal(response.status, 201)
    const character = await response.json() as { id: string; version: number }
    assert.equal((await request(root + '/world', 'POST', newWorld())).status, 201)
    assert.equal((await request(root + '/story-bible')).status, 200)
    assert.equal((await request(`/novels/${b.id}/characters/${character.id}`, 'PUT', { ...newCharacter(), version: 1 })).status, 404)
    assert.equal((await request(`${root}/characters/${character.id}`, 'PUT', { ...newCharacter(), version: 1, name: '新版本' })).status, 200)
    assert.equal((await request(`${root}/characters/${character.id}`, 'PUT', { ...newCharacter(), version: 1 })).status, 409)
    assert.equal((await request(root + '/world', 'POST', { ...newWorld(), category: 'invalid' })).status, 400)
    backups.busy = true
    assert.equal((await request(root + '/characters', 'POST', newCharacter())).status, 423)
    backups.busy = false
    const snapshot = await backups.create(), prepared = backups.prepare(snapshot.id)
    await backups.restore(snapshot.id, prepared.token, '替换当前全部数据')
    assert.equal((await request(root + '/characters', 'POST', newCharacter())).status, 409)
    assert.equal(f.store.list(a.id).characters[0].name, '新版本')
  } finally {
    backups.busy = false
    try { if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) }
    finally { await backups.stop(); f.cleanup() }
  }
})
