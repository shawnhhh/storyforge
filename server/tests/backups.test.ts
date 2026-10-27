import { schemaVersion } from '../src/db/migrate.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { request as httpRequest } from 'node:http'
import { openDatabase } from '../src/db/database.js'
import { BackupService } from '../src/modules/backups/service.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { createApp } from '../src/app.js'

function fixture(now?: () => number) {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-backup-test-'))
  const db = openDatabase(join(dir, 'data'))
  const service = new BackupService(db, join(dir, 'backups'), now)
  const novels = new NovelStore(db)
  return { dir, db, service, novels, close: async () => { await service.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const rich = { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'text', text: '中文小说 🌕 & <特殊字符>\n第二行' }] }] }

test('official backup includes uncheckpointed WAL, all tables, size, SHA-256 and restart history', async () => {
  const f = fixture()
  try {
    f.db.exec('PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE)')
    const novel = f.novels.create('春日来信', '中文内容')
    const first = f.novels.createChapter(novel.id, novel.version, '第一章')
    f.novels.saveChapter(first.chapter.id, first.chapter.version, first.chapter.title, rich)
    assert.ok(statSync(join(f.dir, 'data/storyforge.sqlite-wal')).size > 0)
    const entry = await f.service.create()
    assert.equal(entry.kind, 'manual')
    assert.match(entry.id, /^storyforge-\d{4}-.*\.sqlite$/)
    const path = join(f.service.directory, entry.id)
    assert.equal(entry.size, statSync(path).size)
    assert.equal(entry.sha256, createHash('sha256').update(readFileSync(path)).digest('hex'))
    assert.equal(statSync(path).mode & 0o777, 0o600)
    assert.deepEqual(f.service.verify(entry.id), entry)
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      assert.deepEqual(new NovelStore(db).chapter(first.chapter.id).content, rich)
      assert.equal(db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
      assert.equal(db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get()?.version, schemaVersion)
    } finally { db.close() }
    assert.deepEqual(new BackupService(f.db, f.service.directory).history().entries, [entry])
  } finally { await f.close() }
})

test('restore rolls back an injected failure, retains a safety snapshot, restores every row and invalidates old sessions', async () => {
  const f = fixture()
  try {
    const novel = f.novels.create('备份时的小说', '')
    const chapter = f.novels.createChapter(novel.id, novel.version, '原章节')
    f.novels.saveChapter(chapter.chapter.id, 1, '原章节', rich)
    const target = await f.service.create()
    const restoredNovel = f.novels.novel(novel.id)
    const restoredChapter = f.novels.chapter(chapter.chapter.id)
    f.novels.update(novel.id, restoredNovel.version, '恢复前的最新小说', '必须可回滚')
    const extra = f.novels.create('备份后新增的小说', '')
    const before = f.novels.list()
    const oldGeneration = f.service.generation
    const prepared = f.service.prepare(target.id)
    await assert.rejects(f.service.restore(target.id, prepared.token, '替换当前全部数据', () => { throw new Error('simulated disk/commit failure') }), /simulated/)
    assert.deepEqual(f.novels.list(), before)
    assert.equal(f.service.generation, oldGeneration)
    const safety = f.service.history().entries.find(item => item.kind === 'before-restore')!
    const saved = new DatabaseSync(join(f.service.directory, safety.id), { readOnly: true })
    try { assert.deepEqual(new NovelStore(saved).list(), before) } finally { saved.close() }
    await assert.rejects(f.service.restore(target.id, prepared.token, '替换当前全部数据'))
    const second = f.service.prepare(target.id)
    const result = await f.service.restore(target.id, second.token, '替换当前全部数据')
    assert.notEqual(result.generation, oldGeneration)
    assert.deepEqual(f.novels.novel(novel.id), restoredNovel)
    assert.deepEqual(f.novels.chapter(chapter.chapter.id), restoredChapter)
    assert.throws(() => f.novels.novel(extra.id))
    assert.equal(f.db.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
    assert.equal(f.service.history().entries.filter(item => item.kind === 'before-restore').length, 2)
  } finally { await f.close() }
})

test('restore rejects corrupt files, SQLite impostors, incompatible schema, traversal, symlinks and expired confirmation', async () => {
  let clock = Date.now()
  const f = fixture(() => clock)
  try {
    f.novels.create('不能丢失的数据', '')
    const before = f.novels.list()
    for (const id of ['../data/storyforge.sqlite', '/etc/passwd', 'settings.json', 'unknown.sqlite']) assert.throws(() => f.service.verify(id))
    const corrupt = await f.service.create()
    writeFileSync(join(f.service.directory, corrupt.id), 'not a database')
    assert.throws(() => f.service.verify(corrupt.id), /校验失败/)
    const changeMetadata = (id: string) => {
      const path = join(f.service.directory, id), metadata = JSON.parse(readFileSync(`${path}.json`, 'utf8'))
      metadata.size = statSync(path).size; metadata.sha256 = createHash('sha256').update(readFileSync(path)).digest('hex')
      writeFileSync(`${path}.json`, JSON.stringify(metadata))
    }
    changeMetadata(corrupt.id)
    assert.throws(() => f.service.verify(corrupt.id), /SQLite/)
    const newer = await f.service.create()
    const newerDb = new DatabaseSync(join(f.service.directory, newer.id))
    newerDb.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(schemaVersion + 1, 'future'); newerDb.close(); changeMetadata(newer.id)
    assert.throws(() => f.service.verify(newer.id), /数据库版本/)
    const broken = await f.service.create()
    const brokenDb = new DatabaseSync(join(f.service.directory, broken.id))
    brokenDb.exec('CREATE TABLE unexpected (secret TEXT)'); brokenDb.close(); changeMetadata(broken.id)
    assert.throws(() => f.service.verify(broken.id), /数据库版本/)
    const linked = await f.service.create()
    rmSync(join(f.service.directory, linked.id)); symlinkSync(join(f.dir, 'data/storyforge.sqlite'), join(f.service.directory, linked.id))
    assert.throws(() => f.service.verify(linked.id), /路径不安全/)
    const valid = await f.service.create()
    const prepared = f.service.prepare(valid.id)
    await assert.rejects(f.service.restore(valid.id, prepared.token, '确认'))
    clock += 5 * 60_000
    await assert.rejects(f.service.restore(valid.id, prepared.token, '替换当前全部数据'))
    assert.deepEqual(f.novels.list(), before)
  } finally { await f.close() }
})

test('automatic backup uses a 24h due check, persists settings, prevents overlap and only prunes automatic history', async () => {
  let clock = Date.now()
  const f = fixture(() => clock)
  try {
    f.service.configure({ enabled: true, retention: 2 })
    const manual = await f.service.create()
    await Promise.all([f.service.checkAutomatic(), f.service.checkAutomatic()])
    assert.equal(f.service.history().entries.filter(entry => entry.kind === 'automatic').length, 1)
    const prepared = f.service.prepare(manual.id)
    await f.service.restore(manual.id, prepared.token, '替换当前全部数据')
    clock += 86_400_000 - 1
    await f.service.checkAutomatic()
    assert.equal(f.service.history().entries.length, 3)
    clock += 1
    await f.service.checkAutomatic()
    clock += 86_400_000
    await f.service.checkAutomatic()
    assert.equal(f.service.history().entries.filter(entry => entry.kind === 'automatic').length, 2)
    assert.equal(f.service.history().entries.filter(entry => entry.kind === 'manual').length, 1)
    assert.equal(f.service.history().entries.filter(entry => entry.kind === 'before-restore').length, 1)
    f.service.configure({ enabled: false, retention: 2 })
    clock += 86_400_000
    await f.service.checkAutomatic()
    assert.equal(f.service.history().entries.length, 4)
    assert.deepEqual(new BackupService(f.db, f.service.directory).history().settings, { enabled: false, retention: 2 })
    for (const retention of [0, 366, 1.5, '2']) assert.throws(() => f.service.configure({ enabled: true, retention }))
  } finally { await f.close() }
})

test('HTTP requires loopback Host, safe origin, session generation and two-stage confirmation; blocks writes while busy', async () => {
  const f = fixture()
  const server = createApp(f.db, f.service).listen(0, '127.0.0.1')
  try {
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api`
    const generation = f.service.generation
    const request = (path: string, body: unknown = {}, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StoryForge-Generation': generation, ...headers }, body: JSON.stringify(body) })
    // fetch/Undici can replace a caller-supplied Host with the URL's host.
    // Use node:http to ensure this security test sends the hostile Host on wire.
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const request = httpRequest(base + '/backups', { headers: { Host: 'evil.example' } }, response => {
        response.resume()
        resolve(response.statusCode)
      })
      request.once('error', reject)
      request.end()
    })
    assert.equal(hostileHostStatus, 403)
    assert.equal((await request('/backups', {}, { Origin: 'https://evil.example' })).status, 403)
    assert.equal((await request('/backups', {}, { 'X-StoryForge-Generation': '' })).status, 409)
    assert.equal((await request('/backups/%2e%2e%2fdata%2fstoryforge.sqlite/verify')).status, 400)
    f.novels.create('原数据', '')
    const target = await (await request('/backups')).json() as { id: string }
    f.service.busy = true
    try { assert.equal((await request('/novels', { title: '不应写入' })).status, 423) }
    finally { f.service.busy = false }
    f.novels.create('恢复后应移除', '')
    assert.equal((await request(`/backups/${target.id}/restore`, { confirmation: '替换当前全部数据' })).status, 400)
    const prepared = await (await request(`/backups/${target.id}/prepare-restore`)).json() as { token: string }
    assert.equal((await request(`/backups/${target.id}/restore`, { token: prepared.token, confirmation: '替换当前全部数据' })).status, 200)
    assert.equal((await request('/novels', { title: '旧窗口写入' })).status, 409)
    assert.equal(f.novels.list().length, 1)
  } finally {
    try {
      if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    } finally { await f.close() }
  }
})

test('startup awaits initial automatic backup before the caller advertises readiness', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-backup-readiness-'))
  const db = openDatabase(dir), service = new BackupService(db, join(dir, 'backups'))
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  service.checkAutomatic = async () => { service.busy = true; await pending; service.busy = false }
  try {
    let ready = false
    const startup = service.start()
    assert.equal(service.start(), startup)
    const initial = startup.then(() => { ready = true })
    await Promise.resolve()
    assert.equal(service.busy, true); assert.equal(ready, false)
    release(); await initial
    assert.equal(service.busy, false); assert.equal(ready, true)
  } finally { release(); await service.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
