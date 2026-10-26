import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { openDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { migratePlanning } from '../src/db/planning-migrate.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { TrashStore } from '../src/modules/trash/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { createApp } from '../src/app.js'
const conflict = (error: unknown) => error instanceof HttpError && error.status === 409
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-trash-timeline-')), db = openDatabase(join(dir, 'data'))
  const novels = new NovelStore(db), bible = new StoryBibleStore(db), planning = new PlanningStore(db), trash = new TrashStore(db)
  const novel = novels.create('虚构联合回收站', ''), chapter = novels.createChapter(novel.id, novel.version, '虚构章节').chapter
  const hero = bible.saveCharacter(novel.id, { ...newCharacter(), name: '虚构人物' }), place = bible.saveWorld(novel.id, { ...newWorld(), name: '虚构地点' })
  const data = emptyPlanning()
  data.cards.push({ id: 'event', title: '虚构事件', content: '', summary: '', status: 'planned', plotlineId: null, storyTime: '元年', timeOrder: 1, chapterIds: [chapter.id], characterIds: [hero.id], worldIds: [place.id] })
  const saved = planning.save(novel.id, 0, data)
  return { dir, db, novels, bible, planning, trash, novel, chapter, hero, place, saved, close() { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
for (const kind of ['characters', 'world'] as const) test(`integrated trash: ${kind} archives timeline links, invalidates stale drafts and restores original IDs`, () => {
  const f = fixture()
  try {
    const target = kind === 'characters' ? f.hero : f.place, field = kind === 'characters' ? 'characterIds' : 'worldIds'
    f.bible.remove(kind, f.novel.id, target.id, target.version)
    assert.deepEqual(f.planning.read(f.novel.id).cards[0][field], [])
    assert.throws(() => f.planning.save(f.novel.id, f.saved.version, f.saved), conflict)
    const entry = f.trash.list()[0]
    assert.equal(entry.affected[kind === 'characters' ? 'planning_character_links' : 'planning_world_links'], 1)
    f.trash.restore(entry.id, true)
    const restored = f.planning.read(f.novel.id)
    assert.deepEqual(restored.cards[0][field], [target.id]); assert.equal(restored.cards[0].id, 'event')
    assert.ok(restored.version > f.saved.version)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.close() }
})
test('integrated trash: removed planning links recover without replacing prose or changing target IDs', () => {
  const f = fixture()
  try {
    const next = structuredClone(f.saved); next.cards[0].characterIds = []; next.cards[0].worldIds = []; next.cards[0].content = '同次保存的新内容'
    f.planning.save(f.novel.id, next.version, next)
    const entry = f.trash.list()[0]; assert.equal(entry.affected.planning_character_links, 1); assert.equal(entry.affected.planning_world_links, 1)
    f.trash.restore(entry.id, true)
    const card = f.planning.read(f.novel.id).cards[0]
    assert.equal(card.content, '同次保存的新内容'); assert.deepEqual(card.characterIds, [f.hero.id]); assert.deepEqual(card.worldIds, [f.place.id])
  } finally { f.close() }
})
test('integrated trash: delayed saves and rebased old drafts cannot resurrect deleted plans, even after purge', () => {
  const f = fixture()
  try {
    const removed = f.planning.save(f.novel.id, f.saved.version, { ...f.saved, cards: [] })
    assert.throws(() => f.planning.save(f.novel.id, f.saved.version, f.saved), conflict)
    assert.throws(() => f.planning.save(f.novel.id, removed.version, f.saved), conflict)
    const entry = f.trash.list()[0]; f.trash.purge(entry.id, true, entry.name)
    assert.throws(() => f.planning.save(f.novel.id, removed.version, f.saved), conflict)
    assert.deepEqual(f.planning.read(f.novel.id), removed)
    const other = f.novels.create('虚构另一作品', '')
    assert.equal(f.planning.save(other.id, 0, { ...f.saved, cards: [{ ...f.saved.cards[0], chapterIds: [], characterIds: [], worldIds: [] }] }).cards[0].id, 'event')
  } finally { f.close() }
})
test('integrated trash: restoring deleted plans permits subsequent normal editing and a second deletion', () => {
  const f = fixture()
  try {
    f.planning.save(f.novel.id, f.saved.version, { ...f.saved, cards: [] })
    f.trash.restore(f.trash.list()[0].id, true)
    const restored = f.planning.read(f.novel.id)
    assert.deepEqual(restored.cards, f.saved.cards)
    const edited = f.planning.save(f.novel.id, restored.version, { ...restored, cards: [{ ...restored.cards[0], title: '恢复后编辑' }] })
    f.planning.save(f.novel.id, edited.version, { ...edited, cards: [] })
    assert.equal(f.trash.list().length, 1)
  } finally { f.close() }
})
test('planning parent deletion preserves linked targets and rejects stale drafts before and after original-ID restoration', () => {
  const f = fixture()
  try {
    const input = structuredClone(f.saved)
    input.outlines = [
      { id: 'parent', title: '虚构父纲', content: '父纲正文', kind: 'overall', parentId: null, chapterIds: [f.chapter.id], characterIds: [f.hero.id], worldIds: [f.place.id] },
      { id: 'child', title: '虚构子纲', content: '子纲正文', kind: 'volume', parentId: 'parent', chapterIds: [f.chapter.id], characterIds: [f.hero.id], worldIds: [f.place.id] },
    ]
    const original = f.planning.save(f.novel.id, input.version, input)
    const draftBytes = JSON.stringify(original)
    const materials = f.bible.list(f.novel.id), chapter = f.novels.chapter(f.chapter.id)
    const removed = f.planning.save(f.novel.id, original.version, { ...original, outlines: [{ ...original.outlines[1], parentId: null }] })
    assert.deepEqual(removed.outlines, [{ ...original.outlines[1], parentId: null }])
    assert.deepEqual(removed.cards, original.cards)
    assert.deepEqual(f.bible.list(f.novel.id), materials)
    assert.deepEqual(f.novels.chapter(f.chapter.id), chapter)
    assert.throws(() => f.planning.save(f.novel.id, original.version, original), conflict)
    assert.throws(() => f.planning.save(f.novel.id, removed.version, original), conflict)
    assert.equal(JSON.stringify(original), draftBytes)
    assert.deepEqual(f.planning.read(f.novel.id), removed)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(f.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
    const entry = f.trash.list().find(row => row.kind === 'planning' && row.name === '虚构父纲')!
    assert.ok(entry)
    f.trash.restore(entry.id, true)
    const restored = f.planning.read(f.novel.id)
    assert.deepEqual(new Map(restored.outlines.map(row => [row.id, row])), new Map(original.outlines.map(row => [row.id, row])))
    assert.deepEqual(restored.cards, original.cards)
    assert.ok(restored.version > removed.version)
    assert.throws(() => f.planning.save(f.novel.id, original.version, original), conflict)
    assert.deepEqual(f.bible.list(f.novel.id), {
      characters: materials.characters.map(row => ({ ...row, version: row.version + 1 })),
      world: materials.world.map(row => ({ ...row, version: row.version + 1 })),
    })
    assert.deepEqual(f.novels.chapter(f.chapter.id), { ...chapter, version: chapter.version + 1 })
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
    assert.equal(f.db.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
  } finally { f.close() }
})
test('integrated trash: archived timeline references protect deleted targets from purge and expiry', () => {
  const f = fixture()
  try {
    f.planning.save(f.novel.id, f.saved.version, { ...f.saved, cards: [] })
    const planEntry = f.trash.list()[0]
    f.bible.remove('characters', f.novel.id, f.hero.id, f.hero.version)
    const heroEntry = f.trash.list().find(row => row.kind === 'characters')!
    assert.throws(() => f.trash.purge(heroEntry.id, true, heroEntry.name), conflict)
    const expires = Date.parse(heroEntry.expiresAt)
    f.db.prepare('UPDATE trash_entries SET deleted_at=?,expires_at=? WHERE id=?').run(new Date(expires).toISOString(), new Date(expires + 30 * 86400000).toISOString(), planEntry.id)
    assert.equal(new TrashStore(f.db, () => expires).cleanup(), 0)
    f.trash.purge(planEntry.id, true, planEntry.name)
    assert.equal(new TrashStore(f.db, () => expires).cleanup(), 1)
  } finally { f.close() }
})
test('integrated trash: cross-novel archive corruption and restoration faults preserve all live rows and archives', () => {
  const f = fixture()
  try {
    f.bible.remove('characters', f.novel.id, f.hero.id, f.hero.version)
    const entry = f.trash.list()[0], before = f.planning.read(f.novel.id)
    const raw = String(f.db.prepare('SELECT payload FROM trash_entries WHERE id=?').get(entry.id)!.payload), payload = JSON.parse(raw)
    payload.rows.planning_character_links[0].novel_id = f.novels.create('虚构异作品', '').id
    f.db.prepare('UPDATE trash_entries SET payload=? WHERE id=?').run(JSON.stringify(payload), entry.id)
    assert.throws(() => f.trash.restore(entry.id, true), conflict)
    assert.deepEqual(f.planning.read(f.novel.id), before)
    f.db.prepare('UPDATE trash_entries SET payload=? WHERE id=?').run(raw, entry.id)
    f.db.exec("CREATE TEMP TRIGGER fail_timeline_restore BEFORE INSERT ON planning_character_links BEGIN SELECT RAISE(ABORT,'fault'); END")
    assert.throws(() => f.trash.restore(entry.id, true), conflict)
    assert.deepEqual(f.planning.read(f.novel.id), before); assert.equal(f.bible.list(f.novel.id).characters.length, 0)
    assert.equal(f.trash.list().length, 1)
  } finally { f.close() }
})
test('integrated trash: an untouched restored novel invalidates version-zero planning and knowledge requests', () => {
  const f = fixture()
  try {
    const novel = f.novels.create('从未保存规划的虚构作品', '')
    f.novels.remove(novel.id, novel.version); f.trash.restore(f.trash.list().find(row => row.novelId === novel.id)!.id, true)
    assert.throws(() => f.planning.save(novel.id, 0, emptyPlanning()), conflict)
    assert.ok(Number(f.db.prepare('SELECT version FROM knowledge_workspaces WHERE novel_id=?').get(novel.id)!.version) > 0)
  } finally { f.close() }
})
test('integrated trash: v5 upgrade preserves archive IDs and seeds durable deletion guards; v6 conflict rolls back', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON'); migrate(db, 5); migratePlanning(db)
    const novels = new NovelStore(db), plans = new PlanningStore(db), trash = new TrashStore(db), novel = novels.create('旧回收站', '')
    const data = emptyPlanning(); data.plotlines.push({ id: 'legacy', title: '旧规划', content: '', kind: 'main' })
    const saved = plans.save(novel.id, 0, data); plans.save(novel.id, saved.version, emptyPlanning())
    const entry = trash.list()[0]
    db.exec('CREATE TABLE deleted_planning_records (unrelated TEXT)')
    assert.throws(() => migrate(db), /already exists/); assert.equal(db.prepare('SELECT max(version) n FROM schema_migrations').get()!.n, 5)
    db.exec('DROP TABLE deleted_planning_records'); migrate(db); migrate(db)
    assert.equal(trash.list()[0].id, entry.id)
    assert.throws(() => plans.save(novel.id, plans.read(novel.id).version, data), conflict)
    trash.restore(entry.id, true); assert.equal(plans.read(novel.id).plotlines[0].id, 'legacy')
  } finally { db.close() }
})
test('integrated trash: backups retain timeline archives and purged-ID guards; failed restore rolls back both', async () => {
  const f = fixture(), service = new BackupService(f.db, join(f.dir, 'backups'))
  try {
    f.planning.save(f.novel.id, f.saved.version, { ...f.saved, cards: [] })
    const archive = f.trash.list()[0], backup = await service.create(), bytes = readFileSync(join(f.dir, 'backups', backup.id))
    f.trash.purge(archive.id, true, archive.name)
    const prepared = service.prepare(backup.id)
    await assert.rejects(service.restore(backup.id, prepared.token, '替换当前全部数据', () => { throw new Error('injected rollback') }), /injected rollback/)
    assert.equal(f.trash.list().length, 0); assert.throws(() => f.planning.save(f.novel.id, f.planning.read(f.novel.id).version, f.saved), conflict)
    const retry = service.prepare(backup.id); await service.restore(backup.id, retry.token, '替换当前全部数据')
    assert.deepEqual(readFileSync(join(f.dir, 'backups', backup.id)), bytes)
    assert.equal(f.trash.list()[0].id, archive.id); f.trash.restore(archive.id, true)
    assert.deepEqual(f.planning.read(f.novel.id).cards, f.saved.cards)
  } finally { await service.stop(); f.close() }
})

test('integrated trash API: concurrent delete/save and duplicate restores serialize; late old saves cannot overwrite restoration', async () => {
  const f = fixture(), server = createApp(f.db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api`
    const send = (path: string, method: string, body: object) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const original = f.novels.chapter(f.chapter.id), novel = f.novels.novel(f.novel.id)
    const [saving, deleting] = await Promise.all([
      send(`/chapters/${original.id}`, 'PUT', { version: original.version, title: original.title, content: original.content }),
      send(`/chapters/${original.id}`, 'DELETE', { version: original.version, novelVersion: novel.version, confirmed: true }),
    ])
    assert.ok((saving.status === 200 && deleting.status === 409) || (deleting.status === 200 && saving.status === 404))
    if (saving.status === 200) {
      const latest = f.novels.chapter(original.id)
      assert.equal((await send(`/chapters/${original.id}`, 'DELETE', { version: latest.version, novelVersion: f.novels.novel(f.novel.id).version, confirmed: true })).status, 200)
    }
    const entry = f.trash.list().find(row => row.kind === 'chapter')!
    const restores = await Promise.all([send(`/trash/${entry.id}/restore`, 'POST', { confirmed: true }), send(`/trash/${entry.id}/restore`, 'POST', { confirmed: true })])
    assert.deepEqual(restores.map(row => row.status).sort(), [204, 404])
    const restored = f.novels.chapter(original.id)
    assert.equal((await send(`/chapters/${original.id}`, 'PUT', { version: original.version, title: '迟到的旧草稿', content: original.content })).status, 409)
    assert.deepEqual(f.novels.chapter(original.id), restored)
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.close() }
})
