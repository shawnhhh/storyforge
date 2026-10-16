import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { KnowledgeLink } from '../../shared/contracts/knowledge.js'
import { migrate } from '../src/db/migrate.js'
import { openDatabase } from '../src/db/database.js'
import { KnowledgeStore, knowledgeInput } from '../src/modules/story-bible/knowledge.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { createApp } from '../src/app.js'
import { newCharacter, newWorld, matchesKnowledge, profileRecords } from '../../src/features/story-bible/model.js'
import { storyApi } from '../../src/features/story-bible/api.js'
import { ApiError } from '../../src/shared/api/client.js'

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-knowledge-test-'))
  const db = openDatabase(join(dir, 'data')), novels = new NovelStore(db), profiles = new StoryBibleStore(db), store = new KnowledgeStore(db)
  const novel = novels.create('资料库 Mock 小说', '独立测试数据'), other = novels.create('其他作品', '')
  const chapter = novels.createChapter(novel.id, novel.version, '第一章').chapter
  const hero = profiles.saveCharacter(novel.id, { ...newCharacter(), name: '林月🌕', category: '主角', tags: ['家族'] })
  const city = profiles.saveWorld(novel.id, { ...newWorld(), name: '云城', description: '浮空城池', tags: ['地理'] })
  const faction = profiles.saveWorld(novel.id, { ...newWorld('organization'), name: '守望者' })
  const links: KnowledgeLink[] = [
    { id: 'world-link', source: { kind: 'world', id: faction.id }, target: { kind: 'world', id: city.id }, label: '驻地', note: '中文 <&> 🌕\n设定备注' },
    { id: 'chapter-reference', source: { kind: 'chapter', id: chapter.id }, target: { kind: 'character', id: hero.id }, label: '出场人物', note: '仅供查阅，不改变正文' },
  ]
  return { dir, db, novels, profiles, store, novel, other, chapter, hero, city, faction, links, cleanup: () => { db.close(); rmSync(dir, { force: true, recursive: true }) } }
}
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected

test('v2 upgrade is additive, idempotent, and failed v3 migration leaves novels and profiles intact', () => {
  for (const fail of [false, true]) {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys=ON'); migrate(db, 2)
      const novels = new NovelStore(db), profiles = new StoryBibleStore(db), novel = novels.create('原有作品', '')
      novels.createChapter(novel.id, novel.version, '原有正文')
      profiles.saveCharacter(novel.id, newCharacter()); profiles.saveWorld(novel.id, newWorld())
      const before = novels.exportData(novel.id), bible = profiles.list(novel.id)
      if (fail) {
        db.exec("CREATE TABLE knowledge_links (original TEXT); INSERT INTO knowledge_links VALUES ('保留原有数据')")
        assert.throws(() => migrate(db), /already exists/)
        assert.equal(db.prepare('SELECT original FROM knowledge_links').get()!.original, '保留原有数据')
        assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='knowledge_workspaces'").get()!.n, 0)
        assert.equal(db.prepare('SELECT max(version) AS n FROM schema_migrations').get()!.n, 2)
      } else {
        migrate(db); const history = db.prepare('SELECT * FROM schema_migrations').all(); migrate(db)
        assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), history)
        assert.deepEqual(new KnowledgeStore(db).read(novel.id), { version: 0, links: [] })
      }
      assert.deepEqual(novels.exportData(novel.id), before); assert.deepEqual(profiles.list(novel.id), bible)
    } finally { db.close() }
  }
})

test('knowledge links persist across connections, serialize concurrent writes and never alter prose or existing associations', () => {
  const f = fixture()
  try {
    const before = f.novels.exportData(f.novel.id), bible = f.profiles.list(f.novel.id)
    const saved = f.store.save(f.novel.id, 0, f.links)
    assert.equal(saved.version, 1)
    const other = openDatabase(join(f.dir, 'data'))
    try {
      const second = new KnowledgeStore(other)
      assert.deepEqual(second.read(f.novel.id), saved)
      const updated = second.save(f.novel.id, saved.version, saved.links.map(item => ({ ...item, note: '另一窗口' })))
      assert.throws(() => f.store.save(f.novel.id, saved.version, []), status(409))
      assert.deepEqual(f.store.read(f.novel.id), updated)
    } finally { other.close() }
    assert.deepEqual(f.novels.exportData(f.novel.id), before)
    assert.deepEqual(f.profiles.list(f.novel.id), bible)
    assert.deepEqual(f.store.read(f.other.id), { version: 0, links: [] })
    assert.throws(() => f.store.read('missing'), status(404))
  } finally { f.cleanup() }
})

test('invalid, duplicate, self and cross-novel links reject atomically and SQLite enforces chapter scope', () => {
  const f = fixture()
  try {
    const foreignWorld = f.profiles.saveWorld(f.other.id, newWorld()), foreignChapter = f.novels.createChapter(f.other.id, 1, '另一部作品章节').chapter
    const saved = f.store.save(f.novel.id, 0, f.links)
    for (const patch of [
      { target: { kind: 'world', id: foreignWorld.id } }, { target: { kind: 'world', id: 'missing' } },
      { source: { kind: 'chapter', id: foreignChapter.id } }, { source: { kind: 'world', id: f.city.id } },
      { target: { kind: 'character', id: f.hero.id } }, { label: '' }, { note: 'x'.repeat(2001) }, { source: { kind: '__proto__', id: 'x' } },
    ]) {
      assert.throws(() => f.store.save(f.novel.id, saved.version, [{ ...f.links[0], ...patch }]), status(400))
      assert.deepEqual(f.store.read(f.novel.id), saved)
    }
    for (const value of [null, {}, [f.links[0], f.links[0]], [f.links[0], { ...f.links[0], id: 'another' }], Array(1001).fill(f.links[0])]) assert.throws(() => knowledgeInput(value), status(400))
    for (const version of [-1, 1.5, '1', null]) assert.throws(() => f.store.save(f.novel.id, version, []), status(400))
    assert.throws(() => f.db.prepare('INSERT INTO knowledge_links VALUES (?,?,?,?,?,?,?,?)').run(f.novel.id, 'foreign', null, foreignChapter.id, f.city.id, null, '参考', ''), /another novel/)
    assert.throws(() => f.db.prepare('UPDATE knowledge_links SET source_chapter_id=? WHERE id=?').run(foreignChapter.id, 'chapter-reference'), /another novel/)
    assert.throws(() => f.db.prepare('INSERT INTO knowledge_links VALUES (?,?,?,?,?,?,?,?)').run(f.novel.id, 'foreign-world', f.faction.id, null, foreignWorld.id, null, '驻地', ''), /FOREIGN KEY/)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.cleanup() }
})

test('target and chapter deletion cascade references and invalidate stale snapshots; novel deletion removes all knowledge data', () => {
  const f = fixture()
  try {
    const saved = f.store.save(f.novel.id, 0, f.links)
    f.profiles.remove('world', f.novel.id, f.city.id, f.city.version)
    const removedWorld = f.store.read(f.novel.id)
    assert.equal(removedWorld.links.length, 1); assert.ok(removedWorld.version > saved.version)
    assert.throws(() => f.store.save(f.novel.id, saved.version, []), status(409))
    f.novels.removeChapter(f.chapter.id, f.chapter.version, f.novels.novel(f.novel.id).version)
    const removedChapter = f.store.read(f.novel.id)
    assert.deepEqual(removedChapter.links, []); assert.ok(removedChapter.version > removedWorld.version)
    f.novels.remove(f.novel.id, f.novels.novel(f.novel.id).version)
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM knowledge_workspaces').get()!.n, 0)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.cleanup() }
})

test('knowledge links and versions survive backup, restore, rollback and process-style reopening', async () => {
  const f = fixture(), backups = new BackupService(f.db, join(f.dir, 'backups'))
  try {
    const saved = f.store.save(f.novel.id, 0, f.links), prose = f.novels.exportData(f.novel.id), snapshot = await backups.create()
    const changed = f.store.save(f.novel.id, saved.version, [])
    let prepared = backups.prepare(snapshot.id)
    await assert.rejects(backups.restore(snapshot.id, prepared.token, '替换当前全部数据', () => { throw new Error('injected restore failure') }), /injected/)
    assert.deepEqual(f.store.read(f.novel.id), changed)
    prepared = backups.prepare(snapshot.id); await backups.restore(snapshot.id, prepared.token, '替换当前全部数据')
    assert.deepEqual(f.store.read(f.novel.id), saved); assert.deepEqual(f.novels.exportData(f.novel.id), prose)
    const reopened = openDatabase(join(f.dir, 'data'))
    try { assert.deepEqual(new KnowledgeStore(reopened).read(f.novel.id), saved) } finally { reopened.close() }
  } finally { await backups.stop(); f.cleanup() }
})

test('HTTP knowledge endpoints enforce versions, local origin, restore generation and backup locks', async () => {
  const f = fixture(), backups = new BackupService(f.db, join(f.dir, 'backups')), server = createApp(f.db, backups).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const url = `http://127.0.0.1:${address.port}/api/novels/${f.novel.id}/knowledge-links`
    const send = (body: unknown, generation: string = backups.generation, origin = 'http://127.0.0.1:5173') => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-StoryForge-Generation': generation, Origin: origin }, body: JSON.stringify(body) })
    assert.deepEqual(await (await fetch(url)).json(), { version: 0, links: [] })
    assert.equal((await send({ version: 0, links: f.links })).status, 200)
    assert.equal((await send({ version: 0, links: [] })).status, 409)
    assert.equal((await send({ version: 1, links: [] }, 'stale')).status, 409)
    assert.equal((await send({ version: 1, links: [] }, backups.generation, 'https://evil.example')).status, 403)
    assert.equal((await send({ version: 1, links: null })).status, 400)
    backups.busy = true
    assert.equal((await send({ version: 1, links: [] })).status, 423)
    backups.busy = false
    assert.equal((await fetch(url.replace(f.novel.id, f.other.id))).status, 200)
  } finally { backups.busy = false; await new Promise<void>(resolve => server.close(() => resolve())); await backups.stop(); f.cleanup() }
})

test('unified library filters mixed profiles by type, category, case-insensitive content and tags', () => {
  const f = fixture()
  try {
    const data = f.profiles.list(f.novel.id), all = profileRecords(data, 'library')
    assert.equal(all.length, 3)
    assert.deepEqual(all.filter(row => matchesKnowledge(row, '浮空', '地理', '', 'location')), [f.city])
    assert.deepEqual(all.filter(row => matchesKnowledge(row, '', '家族', '主角', 'characters')), [f.hero])
    assert.deepEqual(all.filter(row => matchesKnowledge(row, '', '', '', 'organization')), [f.faction])
    assert.equal(all.filter(row => matchesKnowledge(row, '', '', '', 'world')).length, 2)
    assert.equal(all.filter(row => matchesKnowledge(row, '', '不存在', '', '')).length, 0)
  } finally { f.cleanup() }
})

test('Mock HTTP client sends scoped versioned knowledge snapshots and surfaces conflicts without replacing the draft', async t => {
  const snapshot = { version: 2, links: [] }, calls: { path: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (path: string, init?: RequestInit) => { calls.push({ path, init }); return new Response(JSON.stringify(snapshot), { status: 200, headers: { 'Content-Type': 'application/json' } }) })
  assert.deepEqual(await storyApi.links('novel / 中文'), snapshot)
  assert.deepEqual(await storyApi.saveLinks('novel / 中文', snapshot), snapshot)
  assert.equal(calls[0].path, '/api/novels/novel%20%2F%20%E4%B8%AD%E6%96%87/knowledge-links')
  assert.equal(calls[1].init?.method, 'PUT'); assert.deepEqual(JSON.parse(String(calls[1].init?.body)), snapshot)
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: '版本冲突' }), { status: 409 }))
  await assert.rejects(storyApi.saveLinks('novel', snapshot), (error: unknown) => error instanceof ApiError && error.status === 409)
  assert.deepEqual(snapshot, { version: 2, links: [] })
})
