import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db/database.js'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { UnifiedBackupService } from '../src/modules/backups/unified.js'

const dump = (db: DatabaseSync) => db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, db.prepare(`SELECT * FROM "${String(name).replaceAll('"', '""')}"`).all()])

test('Studio v2 upgrades without changing works, assets, history or receipts; reopening is idempotent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-upgrade-safety-'))
  let db = openStudioDatabase(dir)
  try {
    const store = new StudioStore(db)
    const project = store.create({ kind: 'music', title: '升级保留' })
    store.save(project.id, { ...project, content: '原歌词' })
    store.addAsset(project.id, { name: 'original.wav', mime: 'audio/wav', data: 'YWJj' })
    const archive = store.export(project.id), importer = store.importer()
    importer.restore(archive, importer.prepare(archive).token, '作为新项目导入')
    // Reconstruct v2: the two v3-only tables did not exist yet.
    db.exec('DROP TABLE studio_task_media; DROP TABLE studio_music_calls; DROP TABLE studio_cost_reservations; DROP TABLE studio_cost_quotes; DROP TABLE studio_uploads; DROP TABLE studio_media_refs; DROP TABLE studio_media_objects; DROP TABLE studio_job_events; DROP TABLE studio_jobs; DROP TABLE unified_restores; DROP TABLE unified_drafts; PRAGMA user_version=2')
    const before = dump(db)
    db.close(); db = openStudioDatabase(dir)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 7)
    assert.deepEqual(dump(db).filter(([name]) => !['unified_restores', 'unified_drafts', 'studio_jobs', 'studio_job_events', 'studio_task_media', 'studio_music_calls', 'studio_cost_reservations', 'studio_cost_quotes', 'studio_uploads', 'studio_media_refs', 'studio_media_objects'].includes(String(name))), before)
    const after = dump(db)
    db.close(); db = openStudioDatabase(dir)
    assert.deepEqual(dump(db), after)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('future Studio schema is refused without changing stored content, history, receipts or schema version', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-future-safety-'))
  const db = openStudioDatabase(dir)
  try {
    new StudioStore(db).create({ kind: 'video', title: '新版工程' })
    db.exec('PRAGMA user_version=8')
    const before = dump(db)
    assert.throws(() => openStudioDatabase(dir), /newer/)
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 8)
    assert.deepEqual(dump(db), before)
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const kind of ['music', 'video'] as const) test(`${kind} import followed by unified backup restore preserves originals, history, media and task links`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-composed-safety-'))
  const story = openDatabase(dir), studio = openStudioDatabase(dir)
  try {
    const store = new StudioStore(studio)
    const original = store.create({ kind, title: '组合恢复原作' })
    const saved = store.save(original.id, { ...original, content: '歌词或剧本' })
    const task = await store.generate(original.id, { version: saved.version, prompt: 'mock' })
    for (let i = 0; i < 100 && store.tasks(original.id)[0].status !== 'completed'; i++) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(store.tasks(original.id)[0].status, 'completed')
    const exported = store.export(original.id), importer = store.importer()
    const imported = importer.restore(exported, importer.prepare(exported).token, '作为新项目导入')
    const importedBefore = store.export(imported.id)
    const service = new UnifiedBackupService(story, studio, new BackupService(story, join(dir, 'backups')))
    const archive = service.create([])
    const result = service.restore(archive, service.prepare(archive).token, [kind], '恢复为新副本')
    assert.equal(store.list(kind).length, 4)
    assert.deepEqual(store.export(original.id), exported)
    assert.deepEqual(store.export(imported.id), importedBefore)
    for (const source of [original.id, imported.id]) {
      const copy = store.export(result.idMap[source]), before = store.export(source)
      assert.notEqual(copy.project.id, source)
      assert.equal(copy.project.content, before.project.content)
      assert.deepEqual(copy.history.map(v => v.content), before.history.map(v => v.content))
      assert.deepEqual(copy.assets.map(a => a.data), before.assets.map(a => a.data))
      assert.equal(copy.tasks[0].assetId, copy.assets[0].id)
      assert.notEqual(copy.tasks[0].id, task.id)
    }
    for (const db of [story, studio]) {
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
    }
  } finally { studio.close(); story.close(); rmSync(dir, { recursive: true, force: true }) }
})
