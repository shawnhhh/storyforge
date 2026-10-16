import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { characterInput, worldInput } from '../story-bible/validation.js'
import type { TrashEntry, TrashPreview } from '../../../../shared/contracts/trash.js'
import { PlanningStore } from '../planning/store.js'
import { planningInput } from '../planning/validation.js'
import { randomUUID } from 'node:crypto'
import type { DatabaseSync, SQLInputValue } from 'node:sqlite'
import { HttpError } from '../novels/store.js'

// Parent-first order is also the restore order. Only these tables/columns from
// the server schema can be inserted; no SQL identifier comes from HTTP/payload.
const tables = ['novels', 'chapters', 'characters', 'world_entries', 'planning_workspaces', 'planning_records', 'planning_chapter_links', 'character_relations', 'character_world_links', 'knowledge_workspaces', 'knowledge_links'] as const
type Table = typeof tables[number]
type Row = Record<string, SQLInputValue>
type Snapshot = Partial<Record<Table, Row[]>>
type Patch = { before: Row; after: Row }
export type TrashPayload = { rows: Snapshot; patches: Patch[] }
const textSchema = getSchema([StarterKit])
const keys: Record<Table, string[]> = { novels: ['id'], chapters: ['id'], characters: ['id'], world_entries: ['id'], planning_workspaces: ['novel_id'], planning_records: ['novel_id', 'id'], planning_chapter_links: ['novel_id', 'record_id', 'chapter_id', 'role'], character_relations: ['novel_id', 'source_id', 'target_id', 'kind'], character_world_links: ['novel_id', 'character_id', 'world_id'], knowledge_workspaces: ['novel_id'], knowledge_links: ['novel_id', 'id'] }
const identity = (table: Table, row: Row) => JSON.stringify(keys[table].map(key => row[key]))
export function snapshot(db: DatabaseSync, novelId: string, selected: readonly Table[] = tables): Snapshot {
  const result: Snapshot = {}
  for (const table of selected) {
    if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) continue
    result[table] = db.prepare(`SELECT * FROM ${table} WHERE ${table === 'novels' ? 'id' : 'novel_id'}=?`).all(novelId) as Row[]
  }
  return result
}
export function archiveRemoved(db: DatabaseSync, before: Snapshot, novelId: string, kind: string, name: string, planningPatches = false, now = Date.now()) {
  if (!db.isTransaction) throw new Error('Archive requires a transaction')
  const after = snapshot(db, novelId, Object.keys(before) as Table[]), rows: Snapshot = {}, patches: Patch[] = []
  for (const table of tables) {
    const remaining = new Set((after[table] ?? []).map(row => identity(table, row)))
    const removed = (before[table] ?? []).filter(row => !remaining.has(identity(table, row)))
    if (removed.length) rows[table] = removed
  }
  if (planningPatches) for (const old of before.planning_records ?? []) {
    const next = after.planning_records?.find(row => row.id === old.id)
    if (next && old.data !== next.data) {
      const previous = JSON.parse(String(old.data)), current = JSON.parse(String(next.data))
      const removedReference = ['parentId', 'plotlineId'].some(key => previous[key] && previous[key] !== current[key]) || (previous.cardIds ?? []).some((id: string) => !(current.cardIds ?? []).includes(id))
      if (removedReference) patches.push({ before: old, after: next })
    }
  }
  if (!Object.keys(rows).length && !patches.length) return
  // Pre-v5 fixtures are only used by historical backup validation, never app writes.
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE name='trash_entries'").get()) throw new HttpError(409, '请先升级数据库再删除')
  db.prepare('INSERT INTO trash_entries VALUES (?,?,?,?,?,?,?)').run(randomUUID(), novelId, kind, name, new Date(now).toISOString(), new Date(now + 30 * 86400000).toISOString(), JSON.stringify({ rows, patches }))
}
export function requireConfirmation(value: unknown) {
  if (value !== true) throw new HttpError(400, '请明确确认删除及影响范围')
}
export class TrashStore {
  constructor(private db: DatabaseSync, private now = () => Date.now()) {}
  private transaction<T>(operation: () => T) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const value = operation(); this.db.exec('COMMIT'); return value }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  list(): TrashEntry[] {
    return this.db.prepare(`SELECT id,novel_id AS novelId,kind,name,deleted_at AS deletedAt,expires_at AS expiresAt,payload FROM trash_entries ORDER BY deleted_at DESC,id`).all().map(({ payload, ...row }) => {
      const parsed = this.validatePayload(String(payload))
      return { id: String(row.id), novelId: String(row.novelId), kind: String(row.kind), name: String(row.name), deletedAt: String(row.deletedAt), expiresAt: String(row.expiresAt), affected: { ...Object.fromEntries(Object.entries(parsed.rows).map(([table, rows]) => [table, rows.length])), ...(parsed.patches.length ? { planningReferences: parsed.patches.length } : {}) } }
    })
  }
  private entry(id: string) {
    const row = this.db.prepare('SELECT * FROM trash_entries WHERE id=?').get(id)
    if (!row) throw new HttpError(404, '回收站记录不存在或已经处理')
    return row
  }
  private validateRetention(entry: Record<string, unknown>) {
    const deleted = Date.parse(String(entry.deleted_at)), expires = Date.parse(String(entry.expires_at))
    if (!Number.isFinite(deleted) || !Number.isFinite(expires) || expires - deleted !== 30 * 86400000) throw new HttpError(409, '回收站保留期限记录无效，已阻止操作')
  }
  preview(id: string): TrashPreview {
    const entry = this.entry(id), payload = this.validatePayload(String(entry.payload))
    const documents: TrashPreview['documents'] = []
    function prose(value: unknown): string {
      if (!value || typeof value !== 'object') return ''
      const node = value as { text?: string; content?: unknown[]; type?: string }
      return (node.text ?? '') + (node.content ?? []).map(prose).join('') + (['paragraph', 'heading'].includes(node.type ?? '') ? '\n' : '')
    }
    for (const row of payload.rows.novels ?? []) documents.push({ title: String(row.title), text: String(row.description) })
    for (const row of payload.rows.chapters ?? []) documents.push({ title: String(row.title), text: prose(JSON.parse(String(row.content))) })
    for (const row of payload.rows.characters ?? []) documents.push({ title: String(row.name), text: Object.values(JSON.parse(String(row.fields))).filter(Boolean).join('\n') })
    for (const row of payload.rows.world_entries ?? []) documents.push({ title: String(row.name), text: String(row.description) })
    for (const row of payload.rows.planning_records ?? []) {
      const data = JSON.parse(String(row.data))
      documents.push({ title: data.title, text: [data.summary, data.content].filter(Boolean).join('\n') })
    }
    for (const row of payload.rows.character_relations ?? []) documents.push({ title: '人物关系', text: String(row.kind) })
    for (const row of payload.rows.knowledge_links ?? []) documents.push({ title: '资料引用：' + String(row.label), text: String(row.note) })
    if (!documents.length) documents.push({ title: '关联快照', text: '原关联已保存；恢复前将校验所属小说、关联目标和当前版本。' })
    return { name: String(entry.name), documents }
  }
  validatePayload(payload: string): TrashPayload {
    try {
      const value = JSON.parse(payload) as TrashPayload
      if (!value || !value.rows || typeof value.rows !== 'object' || Array.isArray(value.rows) || !Array.isArray(value.patches) || value.patches.length > 10000) throw new Error('Invalid payload')
      const validateRow = (table: Table, row: Row) => {
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(row => String(row.name)).sort()
        if (!row || typeof row !== 'object' || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns) || Object.values(row).some(v => v !== null && typeof v !== 'string' && typeof v !== 'number')) throw new Error('Invalid row')
        if (table === 'chapters') {
          if (row.content_schema_version !== 1) throw new Error('Invalid document version')
          const doc = JSON.parse(String(row.content))
          if (doc.type !== 'doc') throw new Error('Invalid document')
          textSchema.nodeFromJSON(doc).check()
        }
        if (table === 'characters') characterInput({ ...row, tags: JSON.parse(String(row.tags)), fields: JSON.parse(String(row.fields)), relations: [], worldIds: [] })
        if (table === 'world_entries') worldInput({ ...row, tags: JSON.parse(String(row.tags)), timeText: row.time_text, sortOrder: row.sort_order, onTimeline: row.on_timeline === 1 })
        if (table === 'planning_records') {
          const data = JSON.parse(String(row.data))
          if (data.id !== row.id || typeof data.title !== 'string') throw new Error('Invalid planning record')
        }
      }
      for (const [table, rows] of Object.entries(value.rows)) {
        if (!tables.includes(table as Table) || !Array.isArray(rows) || !rows.length) throw new Error('Invalid table')
        for (const row of rows) validateRow(table as Table, row)
      }
      for (const patch of value.patches) {
        validateRow('planning_records', patch.before); validateRow('planning_records', patch.after)
        if (patch.before.id !== patch.after.id || patch.before.novel_id !== patch.after.novel_id) throw new Error('Invalid patch scope')
      }
      return value
    } catch { throw new HttpError(409, '回收站记录格式或正文无效，已阻止操作，数据已保留') }
  }
  restore(id: string, confirmed: unknown) {
    requireConfirmation(confirmed)
    return this.transaction(() => {
      const entry = this.entry(id)
      this.validateRetention(entry)
      if (Date.parse(String(entry.expires_at)) <= this.now()) throw new HttpError(409, '已超过 30 天保留期限，不能恢复')
      const payload = this.validatePayload(String(entry.payload)), novelId = String(entry.novel_id)
      if (!(payload.rows.novels?.length) && !this.db.prepare('SELECT id FROM novels WHERE id=?').get(novelId)) throw new HttpError(409, '请先恢复所属小说；父对象不存在时不能恢复')
      // Workspace revisions are monotonic; never overwrite another window's edits.
      for (const table of tables) for (const original of payload.rows[table] ?? []) {
        if (String(original[table === 'novels' ? 'id' : 'novel_id']) !== novelId) throw new HttpError(409, '回收站对象范围无效')
        if (table.endsWith('_workspaces') && this.db.prepare(`SELECT 1 FROM ${table} WHERE novel_id=?`).get(novelId)) continue
        const row = { ...original }
        if ('version' in row) row.version = Number(row.version) + 1
        if ('updated_at' in row) row.updated_at = new Date(this.now()).toISOString()
        if (table === 'chapters' && !payload.rows.novels?.length) {
          const position = Math.min(Number(row.position), Number(this.db.prepare('SELECT count(*) AS n FROM chapters WHERE novel_id=?').get(novelId)!.n))
          this.db.prepare('UPDATE chapters SET position=position+1 WHERE novel_id=? AND position>=?').run(novelId, position)
          row.position = position
        }
        const columns = this.db.prepare(`PRAGMA table_info(${table})`).all().map(col => String(col.name))
        try { this.db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...columns.map(column => row[column])) }
        catch { throw new HttpError(409, '恢复被阻止：关联目标尚未恢复、对象已存在或数据不兼容。请先恢复关联对象；当前数据未更改。') }
      }
      for (const patch of payload.patches) {
        if (patch.before.novel_id !== novelId) throw new HttpError(409, '回收站关联范围无效')
        const row = this.db.prepare('SELECT data FROM planning_records WHERE novel_id=? AND id=?').get(novelId, patch.after.id)
        if (row?.data !== patch.after.data) throw new HttpError(409, '相关规划已修改或删除，无法安全恢复原引用；当前数据未更改')
        // Restore reference fields only: unrelated title/prose edits committed in
        // the same save must survive recovery of a removed association.
        const before = JSON.parse(String(patch.before.data)), after = JSON.parse(String(patch.after.data))
        const restored = { ...after }
        for (const key of ['parentId', 'plotlineId']) if (before[key] && before[key] !== after[key]) restored[key] = before[key]
        if (Array.isArray(before.cardIds)) restored.cardIds = [...new Set([...(after.cardIds ?? []), ...before.cardIds])]
        this.db.prepare('UPDATE planning_records SET data=? WHERE novel_id=? AND id=?').run(JSON.stringify(restored), novelId, patch.before.id)
      }
      // Invalidate all object and association snapshots, including stale autosaves.
      for (const table of ['novels', 'chapters', 'characters', 'world_entries', 'planning_workspaces', 'knowledge_workspaces']) {
        this.db.prepare(`UPDATE ${table} SET version=version+1 WHERE ${table === 'novels' ? 'id' : 'novel_id'}=?`).run(novelId)
      }
      try { planningInput(new PlanningStore(this.db).read(novelId)) } catch { throw new HttpError(409, '规划引用已变化，无法安全恢复；当前数据未更改') }
      if (this.db.prepare('PRAGMA foreign_key_check').all().length) throw new HttpError(409, '关联完整性校验失败，恢复已回滚')
      this.db.prepare('DELETE FROM trash_entries WHERE id=?').run(id)
    })
  }
  private hasDependants(entry: Record<string, unknown>) {
    const owned = this.validatePayload(String(entry.payload)).rows
    const has = (table: Table, id: unknown) => id != null && (owned[table] ?? []).some(row => row.id === id)
    for (const other of this.db.prepare('SELECT * FROM trash_entries WHERE id<>? AND novel_id=?').all(String(entry.id), String(entry.novel_id))) {
      if (owned.novels?.length) return true
      const payload = this.validatePayload(String(other.payload))
      for (const [table, rows] of Object.entries(payload.rows)) for (const row of rows) {
        if ((table === 'planning_chapter_links' && (has('chapters', row.chapter_id) || has('planning_records', row.record_id))) ||
          (table === 'character_relations' && (has('characters', row.source_id) || has('characters', row.target_id))) ||
          (table === 'character_world_links' && (has('characters', row.character_id) || has('world_entries', row.world_id))) ||
          (table === 'knowledge_links' && (has('chapters', row.source_chapter_id) || has('characters', row.target_character_id) || has('world_entries', row.source_world_id) || has('world_entries', row.target_world_id)))) return true
      }
      for (const row of [...(payload.rows.planning_records ?? []), ...payload.patches.map(patch => patch.before)]) {
        const data = JSON.parse(String(row.data))
        if ([data.parentId, data.plotlineId, ...(data.cardIds ?? [])].some(id => has('planning_records', id))) return true
      }
    }
    return false
  }
  purge(id: string, confirmed: unknown, name: unknown) {
    requireConfirmation(confirmed)
    this.transaction(() => {
      const row = this.entry(id)
      if (name !== row.name) throw new HttpError(400, '必须输入完全匹配的对象名称才能永久删除')
      if (this.hasDependants(row)) throw new HttpError(409, '其他回收站项目仍依赖此对象，请先恢复或永久删除这些项目，避免失去父对象或关联目标')
      this.db.prepare('DELETE FROM trash_entries WHERE id=?').run(id)
    })
  }
  cleanup() {
    // The durable expiry queue is retried on startup and hourly. One SQLite write
    // transaction, no live rows/cascades; invalid clocks or payloads fail closed.
    const now = this.now()
    if (!Number.isFinite(now)) throw new Error('Invalid cleanup clock')
    return this.transaction(() => {
      const rows = this.db.prepare('SELECT * FROM trash_entries WHERE expires_at<=?').all(new Date(now).toISOString())
      for (const row of rows) {
        this.validateRetention(row)
        if (now - Date.parse(String(row.deleted_at)) < 30 * 86400000) throw new Error('Unsafe trash retention metadata')
        this.validatePayload(String(row.payload))
      }
      let count = 0
      let pending = rows
      while (pending.length) {
        const ready = pending.filter(row => !this.hasDependants(row))
        if (!ready.length) break // Keep dependency cycles for manual resolution.
        for (const row of ready) count += Number(this.db.prepare('DELETE FROM trash_entries WHERE id=?').run(row.id).changes)
        pending = pending.filter(row => !ready.includes(row))
      }
      return count
    })
  }
}
