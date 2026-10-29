import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'

test('music SQLite rejects invalid BPM and configuration without changing lyrics or version history', () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-music-safety-')), db = openStudioDatabase(directory)
  try {
    const store = new StudioStore(db), song = store.create({ kind: 'music', title: '虚构安全歌曲' })
    const baseline = store.save(song.id, { ...song, content: '必须保留的歌词', settings: { genre: '流行', mood: '平静', tempo: 90, structure: ['主歌', '副歌'] } })
    for (const settings of [{ tempo: -1 }, { tempo: 301 }, { tempo: '120' }, { genre: 42 }, { mood: false }, { structure: ['a'.repeat(101)] }]) {
      assert.throws(() => store.save(song.id, { ...baseline, content: '不得覆盖', settings }))
      assert.deepEqual(store.project(song.id), baseline)
      assert.equal(store.history(song.id).length, 2)
    }
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
  } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
})
