import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { migrate } from '../src/db/migrate.js'
import { migratePlanning } from '../src/db/planning-migrate.js'
import { NovelStore, HttpError } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { createApp } from '../src/app.js'
import { AiContext } from '../src/modules/ai/context.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning, type PlanningSnapshot } from '../../shared/contracts/planning.js'
import { validatePlanning } from '../../shared/domain/planning.js'
import { storyTimeline } from '../../shared/domain/timeline.js'

function populate(db: DatabaseSync) {
  const novels = new NovelStore(db), bible = new StoryBibleStore(db), store = new PlanningStore(db)
  const novel = novels.create('时间线隔离测试', ''), chapter = novels.createChapter(novel.id, novel.version, '初见').chapter
  const hero = bible.saveCharacter(novel.id, { ...newCharacter(), name: '寻星' })
  const place = bible.saveWorld(novel.id, { ...newWorld(), name: '北境' })
  const data = emptyPlanning()
  data.outlines.push({ id: 'outline', title: '总纲', content: '', kind: 'overall', parentId: null, chapterIds: [chapter.id], characterIds: [hero.id], worldIds: [place.id] })
  data.cards.push({ id: 'event', title: '初见事件', content: '参与人物相遇', summary: '', status: 'planned', plotlineId: null, storyTime: '元年冬', timeOrder: -2, chapterIds: [chapter.id], characterIds: [hero.id], worldIds: [place.id] })
  return { novels, bible, store, novel, chapter, hero, place, data }
}
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-timeline-')), db = openDatabase(join(dir, 'data'))
  return { dir, db, ...populate(db), close: () => { db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
const badRequest = (error: unknown) => error instanceof HttpError && error.status === 400

test('integrated planning references reconstruct normalized materials without loading unrelated plans', () => {
  const f = fixture()
  try {
    const saved = f.store.save(f.novel.id, 0, f.data)
    // PR19 stores material IDs in link tables; PR21 reads one selected record.
    const stored = JSON.parse(String(f.db.prepare('SELECT data FROM planning_records WHERE novel_id=? AND id=?').get(f.novel.id, 'outline')!.data))
    assert.deepEqual(stored.characterIds, []); assert.deepEqual(stored.worldIds, [])
    const selected = f.store.readRecord(f.novel.id, 'outlines', 'outline')
    assert.deepEqual(selected, { record: saved.outlines[0], version: saved.version })
    f.store.read = () => { throw new Error('Must not load the complete planning workspace') }
    const context = new AiContext(f.novels, f.bible, f.store)
    const sources: { id: string; text: string }[] = []
    const preview = context.preview(f.chapter.id, { references: [{ kind: 'outline', id: 'outline' }], maxCharacters: 6000 }, (id, _label, text) => sources.push({ id, text }))
    assert.equal(sources.length, 1); assert.equal(sources[0].id, 'outline:outline')
    assert.ok(sources[0].text.includes(f.hero.id)); assert.ok(sources[0].text.includes(f.place.id))
    assert.ok(preview.text.includes(f.chapter.id))
    assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { f.close() }
})

test('integrated single-record references notice deleted materials and preserve source callback and prose', () => {
  const f = fixture()
  try {
    f.store.save(f.novel.id, 0, f.data)
    const context = new AiContext(f.novels, f.bible, f.store)
    const selection = { references: [{ kind: 'card' as const, id: 'event' }], maxCharacters: 6000 }
    const before = context.preview(f.chapter.id, selection)
    f.bible.remove('world', f.novel.id, f.place.id, f.place.version)
    const selected = f.store.readRecord(f.novel.id, 'cards', 'event')
    assert.ok('worldIds' in selected.record); assert.deepEqual(selected.record.worldIds, [])
    const after = context.preview(f.chapter.id, selection)
    assert.notEqual(after.fingerprint, before.fingerprint)
    assert.deepEqual(f.novels.chapter(f.chapter.id), f.chapter)
    const foreign = f.novels.create('其他作品', '')
    assert.throws(() => f.store.readRecord(foreign.id, 'cards', 'event'), error => error instanceof HttpError && error.status === 404)
  } finally { f.close() }
})

test('timeline: outline and event links persist across restart without modifying source documents', () => {
  const f = fixture()
  try {
    const before = { chapter: f.novels.chapter(f.chapter.id), bible: f.bible.list(f.novel.id) }
    const saved = f.store.save(f.novel.id, 0, f.data), second = openDatabase(join(f.dir, 'data'))
    try { assert.deepEqual(new PlanningStore(second).read(f.novel.id), saved) } finally { second.close() }
    assert.deepEqual({ chapter: f.novels.chapter(f.chapter.id), bible: f.bible.list(f.novel.id) }, before)
    assert.equal(f.db.prepare('SELECT count(*) n FROM planning_character_links').get()!.n, 2)
    assert.equal(f.db.prepare('SELECT count(*) n FROM planning_world_links').get()!.n, 2)
  } finally { f.close() }
})

test('timeline: cross-novel, missing and duplicate material references are rejected atomically by validation and foreign keys', () => {
  const f = fixture()
  try {
    const other = f.novels.create('其他小说', ''), stranger = f.bible.saveCharacter(other.id, newCharacter()), foreignPlace = f.bible.saveWorld(other.id, newWorld())
    const saved = f.store.save(f.novel.id, 0, f.data)
    for (const [field, values] of [['characterIds', [stranger.id]], ['worldIds', [foreignPlace.id]], ['worldIds', ['missing']], ['characterIds', [f.hero.id, f.hero.id]]] as const) {
      const invalid = structuredClone(saved); invalid.cards[0][field] = [...values]
      assert.throws(() => f.store.save(f.novel.id, saved.version, invalid), badRequest)
      assert.deepEqual(f.store.read(f.novel.id), saved)
    }
    assert.throws(() => f.db.prepare('INSERT INTO planning_character_links VALUES (?,?,?)').run(f.novel.id, 'event', stranger.id), /FOREIGN KEY/)
    assert.throws(() => f.db.prepare('INSERT INTO planning_world_links VALUES (?,?,?)').run(f.novel.id, 'event', foreignPlace.id), /FOREIGN KEY/)
  } finally { f.close() }
})

test('timeline: deleting referenced materials cleans links, preserves events and invalidates stale drafts', () => {
  const f = fixture()
  try {
    const saved = f.store.save(f.novel.id, 0, f.data)
    f.bible.remove('characters', f.novel.id, f.hero.id, f.hero.version)
    let fresh = f.store.read(f.novel.id)
    assert.equal(fresh.version, saved.version + 1)
    assert.deepEqual(fresh.cards[0].characterIds, [])
    assert.throws(() => f.store.save(f.novel.id, saved.version, saved), error => error instanceof HttpError && error.status === 409)
    f.bible.remove('world', f.novel.id, f.place.id, f.place.version)
    fresh = f.store.read(f.novel.id)
    assert.equal(fresh.version, saved.version + 2)
    assert.deepEqual(fresh.outlines[0].worldIds, [])
    assert.equal(fresh.cards[0].title, '初见事件')
    assert.deepEqual(f.novels.chapter(f.chapter.id), f.chapter)
  } finally { f.close() }
})

test('timeline: snapshot failure rolls back new material links as well as aggregate versions', () => {
  const f = fixture()
  try {
    const saved = f.store.save(f.novel.id, 0, f.data), before = f.novels.novel(f.novel.id)
    f.db.exec("CREATE TRIGGER fail_material BEFORE INSERT ON planning_world_links BEGIN SELECT RAISE(ABORT,'disk failure'); END")
    assert.throws(() => f.store.save(f.novel.id, saved.version, saved), /disk failure/)
    assert.deepEqual(f.store.read(f.novel.id), saved)
    assert.deepEqual(f.novels.novel(f.novel.id), before)
  } finally { f.close() }
})

test('timeline: legacy and incomplete local drafts validate while preserving the new associations', () => {
  const f = fixture()
  try {
    const value = structuredClone(f.data); value.cards[0].title = ''
    assert.deepEqual(validatePlanning(value, true), value)
    assert.throws(() => validatePlanning(value))
    delete value.cards[0].characterIds; delete value.cards[0].worldIds; value.cards[0].title = '旧草稿'
    assert.deepEqual(validatePlanning(value), value)
    assert.throws(() => validatePlanning({ ...value, cards: [{ ...value.cards[0], worldIds: 'invalid' }] }))
  } finally { f.close() }
})

test('timeline: cards and existing world events share a stable timeline with chapter, character and location references', () => {
  const f = fixture()
  try {
    const history = f.bible.saveWorld(f.novel.id, { ...newWorld('history'), name: '旧时代', timeText: '旧历', sortOrder: -10 })
    f.bible.saveCharacter(f.novel.id, { ...f.hero, worldIds: [history.id] }, f.hero.id, f.hero.version)
    f.data.cards.push({ ...f.data.cards[0], id: 'same-time', title: '同序号', timeOrder: -2 }, { ...f.data.cards[0], id: 'undated', title: '无日期', timeOrder: null })
    const before = structuredClone(f.data)
    const rows = storyTimeline(f.data, f.bible.list(f.novel.id), { version: 1, links: [
      { id: 'location', source: { kind: 'world', id: history.id }, target: { kind: 'world', id: f.place.id }, label: '发生于', note: '' },
      { id: 'chapter', source: { kind: 'chapter', id: f.chapter.id }, target: { kind: 'world', id: history.id }, label: '记载', note: '' },
    ] })
    assert.deepEqual(rows.map(row => row.title), ['旧时代', '初见事件', '同序号', '无日期'])
    assert.deepEqual(rows[0].characterIds, [f.hero.id]); assert.deepEqual(rows[0].worldIds, [f.place.id]); assert.deepEqual(rows[0].chapterIds, [f.chapter.id])
    assert.equal(rows[1].description, '参与人物相遇')
    assert.deepEqual(f.data, before)
  } finally { f.close() }
})

test('timeline API: linked event snapshot and JSON export round-trip; cross-work updates fail without changing prose', async () => {
  const f = fixture(), server = createApp(f.db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>(resolve => server.once('listening', resolve))
    const address = server.address(); assert.ok(address && typeof address === 'object')
    const base = `http://127.0.0.1:${address.port}/api/novels/${f.novel.id}`
    const response = await fetch(`${base}/planning`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...f.data, version: 0 }) })
    assert.equal(response.status, 200)
    const saved = await response.json() as PlanningSnapshot
    const exported = await (await fetch(`${base}/export?format=json`)).json() as { planning: PlanningSnapshot; chapters: { content: unknown }[] }
    assert.deepEqual(exported.planning, saved)
    assert.deepEqual(exported.chapters[0].content, f.chapter.content)
    const other = f.novels.create('API 另一小说', ''), person = f.bible.saveCharacter(other.id, newCharacter())
    const invalid = { ...saved, cards: [{ ...saved.cards[0], characterIds: [person.id] }] }
    assert.equal((await fetch(`${base}/planning`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(invalid) })).status, 400)
    assert.deepEqual(f.store.read(f.novel.id), saved)
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); f.close() }
})

test('planning/002: conflicting tables and invalid migration history fail without modifying existing data', () => {
  for (const conflict of ['table', 'history']) {
    const db = new DatabaseSync(':memory:')
    try {
      migrate(db); migratePlanning(db, 1)
      const f = populate(db); const saved = f.store.save(f.novel.id, 0, { ...f.data, outlines: [], cards: [] })
      if (conflict === 'table') db.exec("CREATE TABLE planning_world_links(note TEXT); INSERT INTO planning_world_links VALUES ('must retain')")
      else db.exec("INSERT INTO planning_migrations VALUES ('planning/004','future')")
      assert.throws(() => migratePlanning(db), conflict === 'table' ? /already exists/ : /history/)
      assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='planning_character_links'").get()!.n, 0)
      assert.deepEqual(f.store.read(f.novel.id), saved)
      if (conflict === 'table') assert.equal(db.prepare('SELECT note FROM planning_world_links').get()!.note, 'must retain')
    } finally { db.close() }
  }
})

for (const [base, module, variant] of [[2, 2, 'base'], [3, 2, 'base'], [3, 2, 'knowledge'], [4, 0, 'base'], [4, 1, 'base'], [4, 2, 'base'], [5, 0, 'base'], [5, 1, 'base'], [5, 2, 'base'], [6, 0, 'base'], [6, 1, 'base'], [6, 2, 'base']] as const) {
  test(`backup: ${variant} v${base} + planning v${module} restores and upgrades privately with source bytes unchanged`, async () => {
    const f = fixture(), service = new BackupService(f.db, join(f.dir, 'backups'))
    try {
      const id = `storyforge-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`, path = join(service.directory, id)
      const source = new DatabaseSync(path); source.exec('PRAGMA foreign_keys=ON')
      if (variant === 'knowledge') {
        migrate(source, 2)
        source.exec(readFileSync(new URL('../src/db/migrations/0004_knowledge.sql', import.meta.url), 'utf8'))
        source.prepare('INSERT INTO schema_migrations VALUES (3,?)').run('legacy')
      } else migrate(source, base)
      if (module) migratePlanning(source, module)
      const old = populate(source), input = structuredClone(old.data)
      if (module === 1) for (const row of [...input.outlines, ...input.cards]) { delete row.characterIds; delete row.worldIds }
      const original = module ? old.store.save(old.novel.id, 0, input) : { ...emptyPlanning(), novelId: old.novel.id, version: 0 }
      source.close()
      const bytes = readFileSync(path)
      writeFileSync(path + '.json', JSON.stringify({ id, createdAt: new Date().toISOString(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), schemaVersion: base, planningVersion: module, kind: 'manual' }))
      const live = f.store.save(f.novel.id, 0, f.data)
      let preparation = service.prepare(id)
      await assert.rejects(service.restore(id, preparation.token, '替换当前全部数据', () => { throw new Error('fault') }), /fault/)
      assert.deepEqual(f.store.read(f.novel.id), live)
      preparation = service.prepare(id)
      const { safety } = await service.restore(id, preparation.token, '替换当前全部数据')
      assert.deepEqual(f.store.read(old.novel.id), original)
      assert.deepEqual(readFileSync(path), bytes)
      assert.equal(safety.planningVersion, 2)
      const safe = new DatabaseSync(join(service.directory, safety.id), { readOnly: true })
      try { assert.deepEqual(new PlanningStore(safe).read(f.novel.id), live) } finally { safe.close() }
      assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), [])
    } finally { await service.stop(); f.close() }
  })
}
