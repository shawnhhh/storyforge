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
    for (const row of rows) {
      const record = JSON.parse(String(row.data))
      for (const role of chapterRoles) if (role in record) record[role] = links.filter(link => link.record_id === row.id && link.role === role).map(link => String(link.chapter_id))
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
      if (current.version !== expected) throw new HttpError(409, '规划已变化，请导出草稿后重新加载，避免覆盖其他窗口的修改')
      const chapters = new Set(this.db.prepare('SELECT id FROM chapters WHERE novel_id=?').all(novelId).map(row => row.id))
      for (const record of Object.values(data).flat()) for (const role of chapterRoles) {
        if (role in record && (record[role as keyof typeof record] as unknown as string[]).some(id => !chapters.has(id))) throw new HttpError(400, '关联章节不存在或属于其他作品，请核对草稿中的章节关联')
      }
      this.db.prepare('INSERT INTO planning_workspaces VALUES (?,1) ON CONFLICT(novel_id) DO UPDATE SET version=version+1').run(novelId)
      this.db.prepare('DELETE FROM planning_records WHERE novel_id=?').run(novelId)
      for (const [kind, records] of Object.entries(data) as [keyof PlanningData, PlanningData[keyof PlanningData]][]) records.forEach((record, position) => {
        const stored = { ...record } as Record<string, unknown>
        for (const role of chapterRoles) if (role in stored) stored[role] = []
        this.db.prepare('INSERT INTO planning_records VALUES (?,?,?,?,?)').run(novelId, record.id, kind, position, JSON.stringify(stored))
        for (const role of chapterRoles) if (role in record) for (const chapter of (record as unknown as Record<string, string[]>)[role]) {
          this.db.prepare('INSERT INTO planning_chapter_links VALUES (?,?,?,?)').run(novelId, record.id, chapter, role)
        }
      })
      this.db.prepare('UPDATE novels SET version=version+1,updated_at=? WHERE id=?').run(new Date().toISOString(), novelId)
      const result = this.read(novelId)
      this.db.exec('COMMIT'); return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
