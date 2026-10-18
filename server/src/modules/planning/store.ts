import { archiveRemoved, snapshot } from '../trash/store.js'
import type { DatabaseSync } from 'node:sqlite'
import { emptyPlanning, type PlanningData, type PlanningSnapshot } from '../../../../shared/contracts/planning.js'
import { NovelStore, HttpError } from '../novels/store.js'
import { planningInput } from './validation.js'
export const chapterRoles = ['chapterIds', 'plantedChapterIds', 'plannedChapterIds', 'resolvedChapterIds'] as const
export class PlanningStore {
  constructor(private db: DatabaseSync) {}
  read(novelId: string): PlanningSnapshot {
    if (this.db.isTransaction) return this.readSnapshot(novelId)
    this.db.exec('BEGIN')
    try { const result = this.readSnapshot(novelId); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private readSnapshot(novelId: string): PlanningSnapshot {
    new NovelStore(this.db).novel(novelId)
    const data = emptyPlanning()
    const rows = this.db.prepare('SELECT id, kind, data FROM planning_records WHERE novel_id=? ORDER BY position,id').all(novelId)
    const links = this.db.prepare('SELECT record_id,chapter_id,role FROM planning_chapter_links WHERE novel_id=? ORDER BY chapter_id').all(novelId)
    const hasMaterials = !!this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='planning_character_links' AND type='table'").get()
    const characters = hasMaterials ? this.db.prepare('SELECT record_id,character_id FROM planning_character_links WHERE novel_id=? ORDER BY character_id').all(novelId) : []
    const worlds = hasMaterials ? this.db.prepare('SELECT record_id,world_id FROM planning_world_links WHERE novel_id=? ORDER BY world_id').all(novelId) : []
    for (const row of rows) {
      const record = JSON.parse(String(row.data))
      for (const role of chapterRoles) if (role in record) record[role] = links.filter(link => link.record_id === row.id && link.role === role).map(link => String(link.chapter_id))
      if (row.kind === 'outlines' || row.kind === 'cards') {
        if ('characterIds' in record) record.characterIds = characters.filter(link => link.record_id === row.id).map(link => String(link.character_id))
        if ('worldIds' in record) record.worldIds = worlds.filter(link => link.record_id === row.id).map(link => String(link.world_id))
      }
      data[row.kind as keyof PlanningData].push(record)
    }
    return { ...data, novelId, version: Number(this.db.prepare('SELECT version FROM planning_workspaces WHERE novel_id=?').get(novelId)?.version ?? 0) }
  }
  save(novelId: string, expected: unknown, value: unknown): PlanningSnapshot {
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) throw new HttpError(400, '规划版本号无效')
    const data = planningInput(value)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.read(novelId)
      const before = snapshot(this.db, novelId, ['planning_records', 'planning_chapter_links', 'planning_character_links', 'planning_world_links'])
      if (current.version !== expected) throw new HttpError(409, '规划已变化，请导出草稿后重新加载，避免覆盖其他窗口的修改')
      const existing = new Set(Object.values(current).filter(Array.isArray).flat().map(row => row.id))
      if (this.db.prepare("SELECT 1 FROM sqlite_schema WHERE name='deleted_planning_records'").get()) {
        for (const record of Object.values(data).flat()) if (!existing.has(record.id) && this.db.prepare('SELECT 1 FROM deleted_planning_records WHERE novel_id=? AND id=?').get(novelId, record.id)) throw new HttpError(409, '草稿包含已删除规划，请先从回收站恢复或导出草稿，不能通过保存重新创建')
      }
      const chapters = new Set(this.db.prepare('SELECT id FROM chapters WHERE novel_id=?').all(novelId).map(row => row.id))
      for (const record of Object.values(data).flat()) for (const role of chapterRoles) {
        if (role in record && (record[role as keyof typeof record] as unknown as string[]).some(id => !chapters.has(id))) throw new HttpError(400, '关联章节不存在或属于其他作品，请核对草稿中的章节关联')
      }
      for (const record of [...data.outlines, ...data.cards]) {
        for (const [table, ids] of [['characters', record.characterIds ?? []], ['world_entries', record.worldIds ?? []]] as const) {
          for (const id of ids) if (!this.db.prepare(`SELECT 1 FROM ${table} WHERE novel_id=? AND id=?`).get(novelId, id)) throw new HttpError(400, '关联人物或设定不存在或属于其他作品，请核对草稿中的资料关联')
        }
      }
      this.db.prepare('INSERT INTO planning_workspaces VALUES (?,1) ON CONFLICT(novel_id) DO UPDATE SET version=version+1').run(novelId)
      this.db.prepare('DELETE FROM planning_records WHERE novel_id=?').run(novelId)
      for (const [kind, records] of Object.entries(data) as [keyof PlanningData, PlanningData[keyof PlanningData]][]) records.forEach((record, position) => {
        const stored = { ...record } as Record<string, unknown>
        for (const role of chapterRoles) if (role in stored) stored[role] = []
        for (const role of ['characterIds', 'worldIds']) if (role in stored) stored[role] = []
        this.db.prepare('INSERT INTO planning_records VALUES (?,?,?,?,?)').run(novelId, record.id, kind, position, JSON.stringify(stored))
        for (const role of chapterRoles) if (role in record) for (const chapter of (record as unknown as Record<string, string[]>)[role]) {
          this.db.prepare('INSERT INTO planning_chapter_links VALUES (?,?,?,?)').run(novelId, record.id, chapter, role)
        }
        if (kind === 'outlines' || kind === 'cards') {
          const material = record as PlanningData['cards'][number]
          for (const id of material.characterIds ?? []) this.db.prepare('INSERT INTO planning_character_links VALUES (?,?,?)').run(novelId, record.id, id)
          for (const id of material.worldIds ?? []) this.db.prepare('INSERT INTO planning_world_links VALUES (?,?,?)').run(novelId, record.id, id)
        }
      })
      this.db.prepare('UPDATE novels SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(), novelId)
      const removed = Object.values(data).flat().map(row => row.id)
      const names = Object.values(current).filter(Array.isArray).flat().filter(row => !removed.includes(row.id)).map(row => row.title)
      archiveRemoved(this.db, before, novelId, 'planning', names.length ? names.join('、') : '规划章节关联', true)
      const result = this.read(novelId)
      this.db.exec('COMMIT'); return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
