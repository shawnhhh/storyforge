import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'

test('frozen v2 upgrades to v3 preserving projects, history, media and import receipts across reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-v2-migration-'))
  let db = new DatabaseSync(join(dir, 'studio.sqlite'))
  try {
    db.exec(readFileSync(new URL('./fixtures/studio-v2.sql', import.meta.url), 'utf8'))
    const store = new StudioStore(db)
    const p = store.create({ kind: 'music', title: '迁移夹具' })
    store.save(p.id, { ...p, content: '迁移前歌词', settings: {} })
    store.addAsset(p.id, { name: 'fixture.wav', mime: 'audio/wav', data: 'YWJj' })
    const importer = store.importer()
    const archive = store.export(p.id), preview = importer.prepare(archive)
    const copy = importer.restore(archive, preview.token, '作为新项目导入')
    const tables = ['studio_projects', 'studio_versions', 'studio_assets', 'studio_tasks', 'studio_imports']
    const before = tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())
    db.close()
    for (let attempt = 0; attempt < 2; attempt++) {
      db = openStudioDatabase(dir)
      assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 3)
      assert.deepEqual(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()), before)
      assert.deepEqual(new StudioStore(db).export(p.id), archive)
      assert.equal(new StudioStore(db).project(copy.id).content, '迁移前歌词')
      assert.throws(() => new StudioStore(db).importer().prepare(archive), /已导入/)
      assert.deepEqual(db.prepare('SELECT * FROM unified_restores').all(), [])
      assert.deepEqual(db.prepare('SELECT * FROM unified_drafts').all(), [])
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
      db.close()
    }
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }) }
})

test('failed v2 migration rolls back schema and version without losing existing rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-v2-rollback-'))
  let db = new DatabaseSync(join(dir, 'studio.sqlite'))
  try {
    db.exec(readFileSync(new URL('./fixtures/studio-v2.sql', import.meta.url), 'utf8'))
    new StudioStore(db).create({ kind: 'video', title: '保留原作' })
    db.exec('CREATE INDEX unified_drafts ON studio_projects(title)')
    db.close()
    assert.throws(() => openStudioDatabase(dir), /already an index named unified_drafts/)
    db = new DatabaseSync(join(dir, 'studio.sqlite'))
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 2)
    assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='unified_restores'").get()!.n, 0)
    assert.equal(new StudioStore(db).list('video')[0].title, '保留原作')
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }) }
})
