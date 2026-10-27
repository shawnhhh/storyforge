import { KnowledgeStore } from '../src/modules/story-bible/knowledge.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, schemaVersion } from '../src/db/migrate.js'
import { migratePlanning } from '../src/db/planning-migrate.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { BackupService } from '../src/modules/backups/service.js'
import { openDatabase } from '../src/db/database.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { newCharacter, newWorld } from '../../src/features/story-bible/model.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'

test('v1 upgrade preserves chapters, uses an independent migration name and is idempotent', () => {
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys=ON')
  try {
    migrate(db, 1)
    const novels = new NovelStore(db), novel = novels.create('旧小说', '保留简介'), chapter = novels.createChapter(novel.id, novel.version, '旧章节')
    const before = novels.exportData(novel.id)
    migratePlanning(db, 1); const once = db.prepare('SELECT * FROM planning_migrations').all(); migratePlanning(db, 1)
    assert.deepEqual(db.prepare('SELECT * FROM planning_migrations').all(), once)
    assert.equal(once[0].name, 'planning/001')
    assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all().map(row => row.version), [1])
    assert.deepEqual(novels.exportData(novel.id), before)
    assert.deepEqual(novels.chapter(chapter.chapter.id).content, chapter.chapter.content)
  } finally { db.close() }
})
test('planning migration failure rolls back new module objects and preserves conflicting user data', () => {
  const db = new DatabaseSync(':memory:')
  try {
    migrate(db)
    db.exec("CREATE TABLE planning_records (old_note TEXT); INSERT INTO planning_records VALUES ('保留冲突数据')")
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => migratePlanning(db), /already exists/)
      assert.equal(db.prepare('SELECT old_note FROM planning_records').get()!.old_note, '保留冲突数据')
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name IN ('planning_migrations','planning_workspaces')").get()!.n, 0)
    }
  } finally { db.close() }
})
test('named planning migration can run before or after a later numbered base migration without claiming v2', () => {
  for (const planningFirst of [true, false]) {
    const db = new DatabaseSync(':memory:')
    try {
      migrate(db, 1)
      if (planningFirst) migratePlanning(db, 1)
      migrate(db, 2)
      const novels = new NovelStore(db), novel = novels.create('第三阶段保留作品', '')
      const profiles = new StoryBibleStore(db)
      profiles.saveCharacter(novel.id, { ...newCharacter(), name: '第三阶段保留人物' })
      const before = profiles.list(novel.id)
      migratePlanning(db); migratePlanning(db)
      assert.deepEqual(profiles.list(novel.id), before)
      assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map(row => row.version), [1, 2])
      db.exec("INSERT INTO schema_migrations VALUES (4,'future')")
      assert.throws(() => migrate(db), /newer/)
      db.prepare('INSERT INTO planning_migrations VALUES (?,?)').run('planning/003', 'future')
      assert.throws(() => migratePlanning(db), /newer/)
    } finally { db.close() }
  }
})
for (const baseVersion of [1, 2]) for (const withPlanning of [false, true]) {
  test(`base v${baseVersion}, planning ${withPlanning ? 'v1' : 'absent'} backup restores all modules without rewriting original bytes`, { timeout: 12000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyforge-planning-legacy-')), db = openDatabase(join(dir, 'data'))
    const service = new BackupService(db, join(dir, 'backups'))
    try {
      const id = `storyforge-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`, path = join(service.directory, id)
      const legacy = new DatabaseSync(path)
      legacy.exec('PRAGMA foreign_keys=ON')
      migrate(legacy, baseVersion)
      if (withPlanning) migratePlanning(legacy, 1)
      const oldNovels = new NovelStore(legacy), oldNovel = oldNovels.create('旧快照中的小说', '老数据')
      const chapter = oldNovels.createChapter(oldNovel.id, oldNovel.version, '原章节').chapter
      const oldBible = baseVersion === 2 ? populateBible(legacy, oldNovel.id) : { characters: [], world: [] }
      const value = emptyPlanning(); value.outlines.push({ id: 'outline', title: '旧快照大纲', content: '', kind: 'chapter', parentId: null, chapterIds: [chapter.id] })
      const oldPlanning = withPlanning ? new PlanningStore(legacy).save(oldNovel.id, 0, value) : null
      legacy.close()
      const bytes = readFileSync(path)
      const entry = { id, createdAt: new Date().toISOString(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), schemaVersion: baseVersion, ...(withPlanning ? { planningVersion: 1 } : {}), kind: 'manual' }
      writeFileSync(`${path}.json`, JSON.stringify(entry))
      const novels = new NovelStore(db), live = novels.create('恢复前小说', ''), planning = new PlanningStore(db)
      const liveBible = populateBible(db, live.id)
      const knowledge = new KnowledgeStore(db)
      const liveKnowledge = knowledge.save(live.id, 0, [{ id: 'legacy-safety-reference', source: { kind: 'world', id: liveBible.world[0].id }, target: { kind: 'world', id: new StoryBibleStore(db).saveWorld(live.id, newWorld()).id }, label: '恢复前关联', note: '旧备份恢复前应保留在安全快照' }])
      const liveProfiles = new StoryBibleStore(db).list(live.id)
      planning.save(live.id, 0, { ...value, outlines: value.outlines.map(row => ({ ...row, chapterIds: [] })) })
      assert.deepEqual(service.verify(id), entry)
      const prepared = service.prepare(id)
      const { safety } = await service.restore(id, prepared.token, '替换当前全部数据')
      assert.equal(novels.list().length, 1)
      assert.deepEqual(novels.chapter(chapter.id), chapter)
      assert.deepEqual(new StoryBibleStore(db).list(oldNovel.id), oldBible)
      if (oldPlanning) assert.deepEqual(planning.read(oldNovel.id), oldPlanning)
      else assert.deepEqual(planning.read(oldNovel.id).outlines, [])
      assert.deepEqual(knowledge.read(oldNovel.id), { version: 0, links: [] })
      assert.equal(db.prepare('SELECT MAX(version) AS n FROM schema_migrations').get()!.n, schemaVersion)
      assert.equal(db.prepare('SELECT name FROM planning_migrations').get()!.name, 'planning/001')
      assert.deepEqual(readFileSync(path), bytes)
      const safetyDb = new DatabaseSync(join(service.directory, safety.id), { readOnly: true })
      try {
        assert.equal(new PlanningStore(safetyDb).read(live.id).outlines[0].title, '旧快照大纲')
        assert.deepEqual(new StoryBibleStore(safetyDb).list(live.id), liveProfiles)
        assert.deepEqual(new KnowledgeStore(safetyDb).read(live.id), liveKnowledge)
      } finally { safetyDb.close() }
    } finally { await service.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}
function populateBible(db: DatabaseSync, novelId: string) {
  const store = new StoryBibleStore(db)
  const world = store.saveWorld(novelId, { ...newWorld(), name: '保留世界观' })
  const mentor = store.saveCharacter(novelId, { ...newCharacter(), name: '师父' })
  store.saveCharacter(novelId, { ...newCharacter(), name: '主角', worldIds: [world.id], relations: [{ targetId: mentor.id, kind: '师徒' }] })
  return store.list(novelId)
}
test('planning and its chapter links survive backup, restore, and injected restore failure', { timeout: 12000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-planning-backup-')), db = openDatabase(join(dir, 'data'))
  const service = new BackupService(db, join(dir, 'backups')), novels = new NovelStore(db), planning = new PlanningStore(db)
  try {
    const novel = novels.create('规划备份', ''), chapter = novels.createChapter(novel.id, novel.version, '正文保留').chapter
    const data = emptyPlanning(); data.outlines.push({ id: 'outline', title: '原大纲', content: '中文详细内容', kind: 'chapter', parentId: null, chapterIds: [chapter.id] })
    const originalBible = populateBible(db, novel.id)
    const original = planning.save(novel.id, 0, data), target = await service.create()
    assert.equal(target.planningVersion, 2)
    const changed = planning.save(novel.id, original.version, emptyPlanning())
    const profiles = new StoryBibleStore(db)
    const removed = originalBible.world[0]
    profiles.remove('world', novel.id, removed.id, removed.version)
    const modifiedBible = profiles.list(novel.id)
    const first = service.prepare(target.id)
    await assert.rejects(service.restore(target.id, first.token, '替换当前全部数据', () => { throw new Error('restore failure') }), /restore failure/)
    assert.deepEqual(planning.read(novel.id), changed)
    assert.deepEqual(profiles.list(novel.id), modifiedBible)
    const next = service.prepare(target.id); await service.restore(target.id, next.token, '替换当前全部数据')
    assert.deepEqual(planning.read(novel.id), original)
    assert.deepEqual(profiles.list(novel.id), originalBible)
    assert.deepEqual(novels.chapter(chapter.id), chapter)
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
  } finally { await service.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})

for (const conflict of ['future-history', 'conflicting-table']) test(`startup rolls back base upgrades when planning fails: ${conflict}`, () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-startup-atomic-'))
  const path = join(dir, 'storyforge.sqlite')
  let db = new DatabaseSync(path)
  try {
    migrate(db, 2)
    const novel = new NovelStore(db).create('启动失败保留原数据', '原始简介')
    if (conflict === 'future-history') {
      migratePlanning(db)
      db.exec("INSERT INTO planning_migrations VALUES ('planning/003', 'future')")
    } else db.exec("CREATE TABLE planning_records (note TEXT); INSERT INTO planning_records VALUES ('保留冲突记录')")
    const dump = () => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all()
    const schema = dump(), history = db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()
    const data = new NovelStore(db).exportData(novel.id)
    db.close()
    for (let attempt = 0; attempt < 2; attempt++) {
      assert.throws(() => openDatabase(dir), conflict === 'future-history' ? /newer/ : /already exists/)
      db = new DatabaseSync(path)
      assert.deepEqual(dump(), schema)
      assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all(), history)
      assert.deepEqual(new NovelStore(db).exportData(novel.id), data)
      assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok'])
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      if (conflict === 'conflicting-table') assert.equal(db.prepare('SELECT note FROM planning_records').get()!.note, '保留冲突记录')
      db.close()
    }
  } finally { if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }) }
})
