import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { MockCreativeProvider } from '../src/modules/studio/provider.js'

function fixture() { const dir = mkdtempSync(join(tmpdir(), 'storyforge-studio-')); const db = openStudioDatabase(dir); return { dir, db, store: new StudioStore(db), close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } } }
test('studio projects retain history and reject stale saves atomically across restart', () => {
  const f = fixture()
  try {
    const music = f.store.create({ kind: 'music', title: '歌曲' }), video = f.store.create({ kind: 'video', title: '短片' })
    const saved = f.store.save(music.id, { ...music, content: '歌词', settings: { genre: 'Pop', mood: 'calm', tempo: 100, structure: ['verse','chorus'] } })
    assert.equal(saved.version, 2)
    assert.throws(() => f.store.save(music.id, { ...music, content: '旧稿' }), /已更改/)
    assert.equal(f.store.history(music.id).length, 2); assert.equal(f.store.project(music.id).content, '歌词')
    assert.deepEqual(f.store.list('video').map(p => p.id), [video.id])
    const second = openStudioDatabase(f.dir)
    try { assert.equal(new StudioStore(second).project(music.id).content, '歌词'); assert.equal(second.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok') } finally { second.close() }
  } finally { f.close() }
})
test('studio rejects malformed settings, unsupported assets, invalid IDs without mutating data', () => {
  const f = fixture()
  try {
    const project = f.store.create({ kind: 'video', title: '视频' })
    for (const settings of [{ aspectRatio: 'garbage' }, { shots: '[' }, { shots: JSON.stringify([{ id: 'a', duration: -1, description: '', camera: '' }]) }]) assert.throws(() => f.store.save(project.id, { ...project, settings }), /无效/)
    assert.equal(f.store.history(project.id).length, 1)
    assert.throws(() => f.store.addAsset(project.id, { name: 'evil', mime: 'text/html', data: 'YWJj' }), /不支持/)
    assert.throws(() => f.store.addAsset(project.id, { name: 'evil', mime: 'image/svg+xml', data: 'YWJj' }), /不支持/)
    assert.throws(() => f.store.project('../../user-data'), /不存在/)
    assert.throws(() => f.store.addAsset(project.id, { name: 'large', mime: 'audio/wav', data: Buffer.alloc(650001).toString('base64') }), /大小/)
    const music = f.store.create({ kind: 'music', title: '非法配置' })
    assert.throws(() => f.store.save(music.id, { ...music, settings: { tempo: 301 } }), /速度范围/)
    assert.throws(() => f.store.save(music.id, { ...music, settings: { structure: ['x'.repeat(101)] } }), /结构无效/)
    assert.deepEqual(f.store.assets(project.id), [])
  } finally { f.close() }
})
test('studio complete export includes original media bytes, history and safe filenames', () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind: 'music', title: '备份' })
    const asset = f.store.addAsset(p.id, { name: '../../song.wav', mime: 'audio/wav', data: 'YWJj' })
    assert.equal(asset.bytes, 3); assert.equal(f.store.export(p.id).assets[0].data, 'YWJj'); assert.equal(f.store.export(p.id).history.length, 1)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.close() }
})
test('mock generation persists observable tasks, real media and rejects concurrent or stale work', async () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind: 'music', title: 'mock' })
    await assert.rejects(f.store.generate(p.id, { version: 0, prompt: 'mock' }), /已更改/)
    const queued = await f.store.generate(p.id, { version: p.version, prompt: 'mock' }); assert.equal(queued.status, 'queued')
    await assert.rejects(f.store.generate(p.id, { version: p.version, prompt: 'mock' }), /已有/)
    for (let i = 0; i < 30 && f.store.tasks(p.id)[0].status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 30))
    const done = f.store.tasks(p.id)[0]; assert.equal(done.status, 'completed'); assert.equal(done.progress, 100)
    assert.equal(Buffer.from(f.store.asset(done.assetId!).data as Uint8Array).subarray(0, 4).toString(), 'RIFF')
    const video = f.store.create({ kind: 'video', title: 'mock-video' }); const output = await new MockCreativeProvider().generate({ project: video, prompt: 'mock' })
    assert.equal(output.mime, 'video/webm'); assert.deepEqual([...output.data.subarray(0,4)], [26,69,223,163])
  } finally { f.close() }
})
test('interrupted jobs become failed after reopening without losing projects', () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind: 'music', title: '中断' })
    f.db.prepare("INSERT INTO studio_tasks VALUES('interrupted',?,'mock','running',30,'mock',NULL,NULL,'now')").run(p.id)
    const second = openStudioDatabase(f.dir)
    try { assert.equal(new StudioStore(second).tasks(p.id)[0].status, 'failed'); assert.equal(new StudioStore(second).project(p.id).title, '中断') } finally { second.close() }
  } finally { f.close() }
})
test('failed completion rolls back media insertion and provider errors preserve project history', async () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind: 'music', title: '原子性' }), before = f.store.history(p.id)
    f.db.exec("CREATE TRIGGER reject_studio_completion BEFORE UPDATE ON studio_tasks WHEN NEW.status='completed' BEGIN SELECT RAISE(ABORT,'test failure'); END")
    await f.store.generate(p.id, { version: p.version, prompt: 'mock' })
    for (let i = 0; i < 40 && !['completed', 'failed'].includes(f.store.tasks(p.id)[0].status); i++) await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(f.store.tasks(p.id)[0].status, 'failed'); assert.deepEqual(f.store.assets(p.id), [])
    assert.deepEqual(f.store.history(p.id), before); assert.deepEqual(f.store.project(p.id), p)
    f.db.exec('DROP TRIGGER reject_studio_completion')
    const failing = new StudioStore(f.db, { id: 'mock', generate: async () => { throw new Error('provider failed') } })
    const task = await failing.generate(p.id, { version: p.version, prompt: 'failure' })
    for (let i = 0; i < 40 && !['completed', 'failed'].includes(failing.tasks(p.id).find(t => t.id === task.id)!.status); i++) await new Promise(resolve => setTimeout(resolve, 30))
    assert.equal(failing.tasks(p.id).find(t => t.id === task.id)!.status, 'failed'); assert.deepEqual(failing.assets(p.id), []); assert.deepEqual(failing.history(p.id), before)
  } finally { f.close() }
})
