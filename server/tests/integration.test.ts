import test from 'node:test'
import assert from 'node:assert/strict'
import { backup, DatabaseSync } from 'node:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { migrate, schemaVersion } from '../src/db/migrate.js'
import { migratePlanning } from '../src/db/planning-migrate.js'
import { openDatabase } from '../src/db/database.js'
import { BackupService } from '../src/modules/backups/service.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { DashboardStore } from '../src/modules/dashboard/store.js'
import { KnowledgeStore } from '../src/modules/story-bible/knowledge.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore } from '../src/modules/planning/store.js'
import { emptyPlanning } from '../../shared/contracts/planning.js'
import { newCharacter } from '../../src/features/story-bible/model.js'
import type { RichTextDocument } from '../../shared/contracts/novels.js'
import { search } from '../src/modules/search/routes.js'
import { exportNovel } from '../src/modules/novels/export.js'

const prose = (text: string): RichTextDocument => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
const ddl = (module: 'dashboard' | 'knowledge') => readFileSync(new URL(`../src/db/migrations/${module === 'dashboard' ? '0003_writing_dashboard.sql' : '0004_knowledge.sql'}`, import.meta.url), 'utf8')

for (const module of ['dashboard', 'knowledge'] as const) for (const withPlanning of [false, true]) {
  test(`integration: ${module}-only v3, planning=${withPlanning} upgrades and restores all modules without losing original bytes`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'storyforge-integration-'))
    const dataDir = join(dir, 'data'), backupDir = join(dir, 'backups')
    mkdirSync(dataDir); mkdirSync(backupDir)
    let db = new DatabaseSync(join(dataDir, 'storyforge.sqlite'))
    let service: BackupService | undefined
    try {
      db.exec('PRAGMA foreign_keys=ON')
      migrate(db, 2); db.exec(ddl(module))
      db.prepare('INSERT INTO schema_migrations VALUES (3,?)').run('legacy-branch')
      if (withPlanning) migratePlanning(db)
      let novels = new NovelStore(db)
      const novel = novels.create('Mock 跨分支作品', '')
      const chapter = novels.createChapter(novel.id, novel.version, '保留章节').chapter
      novels.saveChapter(chapter.id, chapter.version, chapter.title, prose('跨分支原正文'))
      const hero = new StoryBibleStore(db).saveCharacter(novel.id, { ...newCharacter(), name: '跨分支人物' })
      if (module === 'knowledge') new KnowledgeStore(db).save(novel.id, 0, [{ id: 'reference', source: { kind: 'chapter', id: chapter.id }, target: { kind: 'character', id: hero.id }, label: '出场', note: 'Mock 引用' }])
      if (module === 'dashboard') new DashboardStore(db).setGoal(1234)
      const planningValue = emptyPlanning()
      planningValue.outlines.push({ id: 'outline', title: '跨分支大纲', content: 'Mock 规划', kind: 'chapter', parentId: null, chapterIds: [chapter.id] })
      if (withPlanning) new PlanningStore(db).save(novel.id, 0, planningValue)
      const original = novels.exportData(novel.id), profiles = new StoryBibleStore(db).list(novel.id)
      const originalKnowledge = module === 'knowledge' ? new KnowledgeStore(db).read(novel.id) : { version: 0, links: [] }
      const originalPlanning = withPlanning ? new PlanningStore(db).read(novel.id) : { ...emptyPlanning(), novelId: novel.id, version: 0 }
      const id = `storyforge-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}.sqlite`, path = join(backupDir, id)
      await backup(db, path)
      const snapshot = new DatabaseSync(path)
      snapshot.exec('PRAGMA journal_mode=DELETE'); snapshot.close()
      const bytes = readFileSync(path)
      writeFileSync(path + '.json', JSON.stringify({ id, createdAt: new Date().toISOString(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), schemaVersion: 3, planningVersion: withPlanning ? 1 : 0, kind: 'manual' }))
      db.close(); db = openDatabase(dataDir); novels = new NovelStore(db)
      const history = db.prepare('SELECT * FROM schema_migrations').all()
      migrate(db)
      assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), history)
      assert.equal(history.length, schemaVersion)
      const knowledge = new KnowledgeStore(db), dashboard = new DashboardStore(db), planning = new PlanningStore(db)
      const checkOriginal = () => {
        assert.deepEqual(novels.exportData(novel.id), original)
        assert.deepEqual(new StoryBibleStore(db).list(novel.id), profiles)
        assert.deepEqual(knowledge.read(novel.id), originalKnowledge)
        assert.deepEqual(planning.read(novel.id), originalPlanning)
        assert.equal(dashboard.read().dailyGoal, module === 'dashboard' ? 1234 : 2000)
        assert.equal(dashboard.read().todayWords, module === 'dashboard' ? 6 : 0)
        assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
      }
      checkOriginal()
      service = new BackupService(db, backupDir)
      assert.equal(service.verify(id).schemaVersion, 3)
      const saved = novels.chapter(chapter.id)
      novels.saveChapter(chapter.id, saved.version, saved.title, prose('跨分支新正文新增'))
      dashboard.setGoal(3456)
      knowledge.save(novel.id, knowledge.read(novel.id).version, [])
      planning.save(novel.id, planning.read(novel.id).version, emptyPlanning())
      const changed = { prose: novels.exportData(novel.id), dashboard: dashboard.read(), knowledge: knowledge.read(novel.id), planning: planning.read(novel.id) }
      let preparation = service.prepare(id)
      const generation = service.generation
      await assert.rejects(service.restore(id, preparation.token, '替换当前全部数据', () => { throw new Error('cross-module rollback') }), /cross-module rollback/)
      assert.deepEqual({ prose: novels.exportData(novel.id), dashboard: dashboard.read(), knowledge: knowledge.read(novel.id), planning: planning.read(novel.id) }, changed)
      assert.equal(service.generation, generation)
      preparation = service.prepare(id)
      const result = await service.restore(id, preparation.token, '替换当前全部数据')
      assert.notEqual(service.generation, generation); checkOriginal()
      assert.deepEqual(readFileSync(path), bytes)
      const safety = new DatabaseSync(join(backupDir, result.safety.id), { readOnly: true })
      try {
        assert.deepEqual(new NovelStore(safety).exportData(novel.id), changed.prose)
        assert.deepEqual(new KnowledgeStore(safety).read(novel.id), changed.knowledge)
        assert.deepEqual(new PlanningStore(safety).read(novel.id), changed.planning)
        assert.deepEqual(new DashboardStore(safety).read(), changed.dashboard)
      } finally { safety.close() }
      // Search and every export format read the restored current data without writes.
      assert.equal(search(db, '原正文', 'chapter', novel.id).hits[0].id, chapter.id)
      assert.equal(search(db, '新正文', 'chapter', novel.id).hits.length, 0)
      for (const format of ['json', 'markdown', 'txt']) {
        const exported = exportNovel(novels, novel.id, format, planning.read(novel.id), { profiles, references: knowledge.read(novel.id) })
        assert.ok(exported.body.includes('跨分支原正文'))
        if (format === 'json') assert.deepEqual(JSON.parse(exported.body).knowledge.references, originalKnowledge)
      }
      checkOriginal()
    } finally { await service?.stop(); db.close(); rmSync(dir, { recursive: true, force: true }) }
  })
}

test('integration: incomplete or mixed v3 module schemas refuse upgrade atomically', () => {
  for (const variant of ['partial', 'mixed']) {
    const db = new DatabaseSync(':memory:')
    try {
      migrate(db, 2); db.exec(ddl('knowledge')); db.prepare('INSERT INTO schema_migrations VALUES (3,?)').run('legacy')
      if (variant === 'partial') db.exec('DROP TRIGGER knowledge_chapter_scope_update')
      else db.exec(ddl('dashboard'))
      const novel = new NovelStore(db).create('必须保留的 Mock 数据', '')
      const before = db.prepare('SELECT * FROM schema_migrations').all()
      assert.throws(() => migrate(db), /Unsupported or incomplete v3/)
      assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), before)
      assert.equal(new NovelStore(db).novel(novel.id).title, novel.title)
    } finally { db.close() }
  }
})
