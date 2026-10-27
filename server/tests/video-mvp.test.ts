import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { MockVideoAdapter } from '../../shared/video/model.js'
function fixture() { const dir = mkdtempSync(join(tmpdir(), 'storyforge-video-unit-')); const db = openStudioDatabase(dir); return { dir, db, store: new StudioStore(db), close() { db.close(); rmSync(dir, { recursive: true, force: true }) } } }
const settings = { aspectRatio: '9:16', shots: JSON.stringify([{ id: 'shot-1', description: '虚构港湾', duration: 7, camera: '推进' }]) }
test('video SQLite saves all storyboard fields, reopens, and preserves history after conflicts', () => {
  const f = fixture()
  try {
    const original = f.store.create({ kind: 'video', title: '虚构项目' })
    const saved = f.store.save(original.id, { version: original.version, title: original.title, content: '虚构剧本', settings })
    assert.throws(() => f.store.save(original.id, { ...saved, version: original.version, content: '旧窗口' }), /已更改/)
    const reopened = openStudioDatabase(f.dir)
    try { const store = new StudioStore(reopened); assert.deepEqual(store.project(saved.id), saved); assert.equal(store.history(saved.id).length, 2); assert.deepEqual(reopened.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(reopened.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok') } finally { reopened.close() }
  } finally { f.close() }
})
test('video SQLite rejects malformed or duplicated shots without advancing version', () => {
  const f = fixture()
  try {
    const p = f.store.create({ kind: 'video', title: '安全校验' })
    for (const invalid of [{ aspectRatio: '2:3' }, { shots: '{bad' }, { shots: JSON.stringify([{ id: 'bad', description: '', camera: '', duration: -1 }]) }]) assert.throws(() => f.store.save(p.id, { ...p, settings: invalid }))
    assert.equal(f.store.project(p.id).version, 1); assert.equal(f.store.history(p.id).length, 1)
  } finally { f.close() }
})
test('video mock task produces a persisted WebM, exact-byte export and distinct project assets', async () => {
  const f = fixture()
  try {
    const a = f.store.create({ kind: 'video', title: '分镜生成' }), b = f.store.create({ kind: 'video', title: '另一个项目' })
    const p = f.store.save(a.id, { ...a, content: '纯虚构剧本', settings })
    const queued = await f.store.generate(p.id, { version: p.version, prompt: new MockVideoAdapter().prompt(p) }); assert.equal(queued.status, 'queued')
    for (let i = 0; i < 50 && f.store.tasks(p.id)[0].status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 20))
    const task = f.store.tasks(p.id)[0]; assert.equal(task.status, 'completed'); assert.equal(task.progress, 100)
    const exported = f.store.export(p.id); assert.equal(exported.assets[0].mime, 'video/webm'); assert.deepEqual([...Buffer.from(exported.assets[0].data, 'base64').subarray(0, 4)], [26, 69, 223, 163]); assert.deepEqual(f.store.assets(b.id), []); assert.deepEqual(f.store.tasks(b.id), [])
    assert.equal(f.store.history(p.id).length, 2)
  } finally { f.close() }
})
