import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, statSync } from 'node:fs'
import { tmpdir, cpus, platform } from 'node:os'
import { join, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { StoryBibleStore } from '../src/modules/story-bible/store.js'
import { PlanningStore, chapterRoles } from '../src/modules/planning/store.js'
import { AiContext } from '../src/modules/ai/context.js'
import { AiPlanning } from '../src/modules/ai/planning.js'
import type { AiModel } from '../src/modules/ai/models.js'
import type { PlanningGenerationInput } from '../../shared/contracts/ai-planning.js'
import { characterProposal, generatedCharacter, planningProposal } from '../../tests/fixtures/ai-planning.js'

const model: AiModel = { id: 'perf-mock', label: '性能模拟模型', provider: 'compatible', apiKey: 'fiction-only', baseUrl: 'https://example.invalid/v1', model: 'fiction-only', timeoutMs: 1000, maxOutputTokens: 4096, inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
function seed(size: number) {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-ai-large-')), db = openDatabase(directory)
  const novels = new NovelStore(db), bible = new StoryBibleStore(db), planning = new PlanningStore(db)
  const novel = novels.create('虚构大作品库', '性能测试，不包含真实资料'), now = new Date().toISOString()
  const perKind = Math.min(1000, size)
  const start = performance.now()
  // Bulk fixture construction only, inside a new temporary database. Every row
  // follows the existing schema; production operations still use the real stores.
  db.exec('BEGIN IMMEDIATE')
  try {
    const person = db.prepare('INSERT INTO characters(id,novel_id,name,category,tags,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    const world = db.prepare('INSERT INTO world_entries(id,novel_id,name,category,tags,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    const chapter = db.prepare('INSERT INTO chapters(id,novel_id,title,content,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
    const longBody = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '虚构正文。'.repeat(800) }] }] })
    for (let i = 0; i < size; i++) {
      const note = i === size - 1 ? 'UNSELECTED_PRIVATE_MARKER' : '虚构背景。'.repeat(200)
      person.run(`person-${i}`, novel.id, `人物${i}`, '配角', '[]', JSON.stringify({ ...generatedCharacter.fields, background: note, notes: '' }), now, now)
      world.run(`world-${i}`, novel.id, `设定${i}`, 'other', '[]', '虚构世界。'.repeat(200), now, now)
      chapter.run(`chapter-${i}`, novel.id, `章节${i}`, longBody, i, now, now)
    }
    const relation = db.prepare('INSERT INTO character_relations VALUES (?,?,?,?)'), worldLink = db.prepare('INSERT INTO character_world_links VALUES (?,?,?)')
    for (let i = 0; i < size; i++) {
      relation.run(novel.id, `person-${i}`, `person-${(i + 1) % size}`, '同伴')
      worldLink.run(novel.id, `person-${i}`, `world-${i}`)
    }
    db.prepare('INSERT INTO planning_workspaces VALUES (?,1)').run(novel.id)
    const record = db.prepare('INSERT INTO planning_records VALUES (?,?,?,?,?)'), link = db.prepare('INSERT INTO planning_chapter_links VALUES (?,?,?,?)')
    for (let i = 0; i < perKind; i++) for (const kind of ['outlines', 'plotlines', 'cards', 'foreshadows'] as const) {
      const row: Record<string, unknown> = { id: `${kind}-${i}`, title: `规划${kind}${i}`, content: '虚构规划。'.repeat(50) }
      if (kind === 'outlines') Object.assign(row, { kind: 'volume', parentId: null, chapterIds: [`chapter-${i}`] })
      if (kind === 'plotlines') Object.assign(row, { kind: 'custom' })
      if (kind === 'cards') Object.assign(row, { summary: '虚构冲突', status: 'planned', plotlineId: `plotlines-${i}`, storyTime: '春季', timeOrder: i, chapterIds: [`chapter-${i}`] })
      if (kind === 'foreshadows') Object.assign(row, { status: 'unplanted', plantedChapterIds: [], plannedChapterIds: [`chapter-${i}`], resolvedChapterIds: [], chapterIds: [`chapter-${i}`], cardIds: [`cards-${i}`] })
      const stored = { ...row }
      for (const role of chapterRoles) if (role in row) stored[role] = []
      record.run(novel.id, row.id as string, kind, i, JSON.stringify(stored))
      for (const role of chapterRoles) if (role in row) for (const chapterId of row[role] as string[]) link.run(novel.id, row.id as string, chapterId, role)
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); db.close(); rmSync(directory, { recursive: true, force: true }); throw error }
  const context = new AiContext(novels, bible, planning), service = new AiPlanning(novels, planning, bible, context, Date.now, () => [model])
  const input: PlanningGenerationInput = { novelId: novel.id, kind: 'world', instructions: '生成虚构设定', modelId: model.id, parameters: { temperature: 0.7, topP: 1, maxOutputTokens: 1024 }, context: { references: [], maxCharacters: 12000 }, parentId: null, chapterIds: [] }
  return { db, novels, bible, planning, novel, context, service, input, seedMs: performance.now() - start, databaseBytes: statSync(join(directory, 'storyforge.sqlite')).size + statSync(join(directory, 'storyforge.sqlite-wal')).size, counts: { characters: size, world: size, chapters: size, planning: perKind * 4, associations: size * 2 + perKind * 4 }, close: () => { db.close(); rmSync(directory, { recursive: true, force: true }) } }
}
function measure(action: () => unknown, count = 20) {
  const samples = Array.from({ length: count }, () => { const start = performance.now(); action(); return performance.now() - start }).sort((a, b) => a - b)
  return { samples: count, p50Ms: samples[Math.floor(count * 0.5)], p95Ms: samples[Math.ceil(count * 0.95) - 1], maxMs: samples.at(-1)! }
}
test('large fictional libraries bound validation/preview/save latency and avoid loading unselected content', { timeout: 120000 }, () => {
  const results = []
  for (const size of [100, 5000]) {
    const f = seed(size)
    try {
      const original = { person: f.bible.character(f.novel.id, 'person-0'), world: f.bible.world(f.novel.id, 'world-0'), chapter: f.novels.chapter('chapter-0'), plan: f.planning.read(f.novel.id) }
      const originalList = f.bible.list.bind(f.bible), originalRead = f.planning.read.bind(f.planning)
      f.bible.list = () => { throw new Error('Unselected full biography read is forbidden') }
      f.planning.read = () => { throw new Error('Unselected full planning read is forbidden') }
      // This is a deterministic complexity guard, independent of runner timing.
      assert.equal(f.service.preview(f.service.validate(f.input), model).context.characters, 0)
      assert.equal(f.context.choicesNovel(f.novel.id).length, size * 3 + Math.min(1000, size) * 4)
      f.bible.list = originalList; f.planning.read = originalRead
      const rssBefore = process.memoryUsage().rss
      const baseline = measure(() => f.service.baseline(f.input), 30)
      const emptyPreview = measure(() => f.service.preview(f.input, model))
      const choices = measure(() => f.context.choicesNovel(f.novel.id), 5)
      const selected = { ...f.input, context: { references: [{ kind: 'character' as const, id: 'person-0' }, { kind: 'world' as const, id: 'world-0' }, { kind: 'chapter' as const, id: 'chapter-0' }, { kind: 'outline' as const, id: 'outlines-0' }], maxCharacters: 12000 } }
      const selectedPreview = measure(() => f.service.preview(selected, model))
      const preview = f.service.preview(selected, model)
      assert.ok(preview.context.characters <= 12000); assert.ok(preview.context.sources.some(source => source.truncated))
      assert.ok(!JSON.stringify(preview.messages).includes('UNSELECTED_PRIVATE_MARKER'))
      const token = f.service.retain(f.input, f.service.baseline(f.input))
      const validity = measure(() => f.service.check(token.previewId), 30)
      const optimizedRssDeltaBytes = Math.max(0, process.memoryUsage().rss - rssBefore)
      const measurement = { counts: f.counts, seedMs: f.seedMs, databaseBytes: f.databaseBytes, baseline, emptyPreview, selectedPreview, validity, choices, optimizedRssDeltaBytes }
      mkdirSync(resolve('work'), { recursive: true })
      writeFileSync(resolve('work/ai-planning-performance-last-measurement.json'), JSON.stringify(measurement, null, 2))
      console.info('AI_PLANNING_PERFORMANCE_MEASUREMENT ' + JSON.stringify(measurement))
      // Fixed, explicit performance budgets; failures retain full measurements.
      assert.ok(baseline.p95Ms < 250, `version baseline p95 ${baseline.p95Ms}ms exceeds 250ms`)
      assert.ok(emptyPreview.p95Ms < 500, `empty preview p95 ${emptyPreview.p95Ms}ms exceeds 500ms`)
      assert.ok(selectedPreview.p95Ms < 500, `selected preview p95 ${selectedPreview.p95Ms}ms exceeds 500ms`)
      assert.ok(validity.p95Ms < 250, `validity p95 ${validity.p95Ms}ms exceeds 250ms`)
      assert.ok(optimizedRssDeltaBytes < 128 * 1024 * 1024, `optimized RSS growth exceeds 128 MiB: ${optimizedRssDeltaBytes}`)
      // Reproduce the previous full-content hash on this exact same fixture as a
      // comparison, not as a substitute for correctness or absolute budgets.
      const legacyFullHash = measure(() => createHash('sha256').update(JSON.stringify({ novel: f.novels.novel(f.novel.id), plan: f.planning.read(f.novel.id), bible: f.bible.list(f.novel.id) })).digest('hex'), 3)
      const saves: Record<string, number> = {}
      for (const kind of ['world', 'character', 'volume'] as const) {
        const input = { ...f.input, kind }, retained = f.service.retain(input, f.service.baseline(input))
        const start = performance.now()
        f.service.save({ previewId: retained.previewId, proposal: kind === 'character' ? characterProposal : planningProposal, confirmed: true })
        saves[kind] = performance.now() - start
        assert.ok(saves[kind] < 3000, `${kind} save exceeds 3000ms: ${saves[kind]}`)
      }
      assert.deepEqual(f.bible.character(f.novel.id, 'person-0'), original.person)
      assert.deepEqual(f.bible.world(f.novel.id, 'world-0'), original.world)
      assert.deepEqual(f.novels.chapter('chapter-0'), original.chapter)
      const after = f.planning.read(f.novel.id)
      for (const key of ['outlines', 'plotlines', 'cards', 'foreshadows'] as const) assert.deepEqual(after[key].filter(row => original.plan[key].some(old => old.id === row.id)), original.plan[key])
      results.push({ counts: f.counts, seedMs: f.seedMs, databaseBytes: f.databaseBytes, baseline, emptyPreview, selectedPreview, validity, choices, legacyFullHash, baselineSpeedupP50: legacyFullHash.p50Ms / baseline.p50Ms, saves, optimizedRssDeltaBytes })
    } finally { f.close() }
  }
  const report = { platform: platform(), node: process.version, cpu: cpus()[0]?.model, budgets: { baselineP95Ms: 250, previewP95Ms: 500, validityP95Ms: 250, saveMs: 3000, optimizedRssDeltaMiB: 128 }, results }
  mkdirSync(resolve('work'), { recursive: true })
  writeFileSync(resolve('work/ai-planning-performance.json'), JSON.stringify(report, null, 2))
  console.info('AI_PLANNING_PERFORMANCE ' + JSON.stringify(report))
})
