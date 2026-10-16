import { archiveRemoved, snapshot } from '../trash/store.js'
import type { DatabaseSync } from 'node:sqlite'
import type { KnowledgeLink, KnowledgeSnapshot } from '../../../../shared/contracts/knowledge.js'
import { HttpError } from '../novels/store.js'

export function knowledgeInput(value: unknown): KnowledgeLink[] {
  if (!Array.isArray(value) || value.length > 1000) throw new HttpError(400, '资料关联须为列表，最多 1000 项')
  const ids = new Set<string>(), edges = new Set<string>()
  function text(value: unknown, max: number, required = true): string {
    if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new HttpError(400, '资料关联文本无效或过长')
    return required ? value.trim() : value
  }
  return value.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('source' in item) || !('target' in item) || !('id' in item) || !('label' in item) || !('note' in item)) throw new HttpError(400, '资料关联格式无效')
    const { source, target } = item
    if (!source || typeof source !== 'object' || !('kind' in source) || !('id' in source) || !['world', 'chapter'].includes(String(source.kind)) || !target || typeof target !== 'object' || !('kind' in target) || !('id' in target) || !['world', 'character'].includes(String(target.kind))) throw new HttpError(400, '资料关联类型无效')
    const link: KnowledgeLink = { id: text(item.id, 100), source: { kind: source.kind as KnowledgeLink['source']['kind'], id: text(source.id, 100) }, target: { kind: target.kind as KnowledgeLink['target']['kind'], id: text(target.id, 100) }, label: text(item.label, 80), note: text(item.note, 2000, false) }
    if (link.source.kind === 'world' && (link.target.kind !== 'world' || link.source.id === link.target.id)) throw new HttpError(400, '设定关联须指向其他设定；人物与设定关联请使用人物档案')
    const edge = JSON.stringify([link.source, link.target, link.label])
    if (ids.has(link.id) || edges.has(edge)) throw new HttpError(400, '资料关联不能重复')
    ids.add(link.id); edges.add(edge)
    return link
  })
}
export class KnowledgeStore {
  constructor(private db: DatabaseSync) {}
  private snapshot(novelId: string): KnowledgeSnapshot {
    if (!this.db.prepare('SELECT id FROM novels WHERE id=?').get(novelId)) throw new HttpError(404, '小说不存在')
    const version = Number(this.db.prepare('SELECT version FROM knowledge_workspaces WHERE novel_id=?').get(novelId)?.version ?? 0)
    const links = this.db.prepare('SELECT * FROM knowledge_links WHERE novel_id=? ORDER BY id').all(novelId).map(row => ({
      id: String(row.id), source: row.source_world_id !== null ? { kind: 'world' as const, id: String(row.source_world_id) } : { kind: 'chapter' as const, id: String(row.source_chapter_id) },
      target: row.target_world_id !== null ? { kind: 'world' as const, id: String(row.target_world_id) } : { kind: 'character' as const, id: String(row.target_character_id) }, label: String(row.label), note: String(row.note),
    }))
    return { version, links }
  }
  read(novelId: string): KnowledgeSnapshot {
    this.db.exec('BEGIN')
    try { const result = this.snapshot(novelId); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  save(novelId: string, expected: unknown, value: unknown): KnowledgeSnapshot {
    if (typeof expected !== 'number' || !Number.isSafeInteger(expected) || expected < 0) throw new HttpError(400, '缺少有效的数据版本号')
    const links = knowledgeInput(value)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.snapshot(novelId)
      const before = snapshot(this.db, novelId, ['knowledge_links'])
      if (current.version !== expected) throw new HttpError(409, '资料关联已在其他窗口变化，请刷新关联后重试')
      for (const link of links) {
        const sourceTable = link.source.kind === 'world' ? 'world_entries' : 'chapters'
        const targetTable = link.target.kind === 'world' ? 'world_entries' : 'characters'
        for (const [table, id] of [[sourceTable, link.source.id], [targetTable, link.target.id]]) {
          if (!this.db.prepare(`SELECT id FROM ${table} WHERE novel_id=? AND id=?`).get(novelId, id)) throw new HttpError(400, '资料或章节不存在，或不属于当前小说')
        }
      }
      this.db.prepare('INSERT INTO knowledge_workspaces VALUES (?,?) ON CONFLICT(novel_id) DO NOTHING').run(novelId, 1)
      this.db.prepare('DELETE FROM knowledge_links WHERE novel_id=?').run(novelId)
      const insert = this.db.prepare('INSERT INTO knowledge_links VALUES (?,?,?,?,?,?,?,?)')
      for (const link of links) insert.run(novelId, link.id, link.source.kind === 'world' ? link.source.id : null, link.source.kind === 'chapter' ? link.source.id : null, link.target.kind === 'world' ? link.target.id : null, link.target.kind === 'character' ? link.target.id : null, link.label, link.note)
      this.db.prepare('UPDATE knowledge_workspaces SET version=? WHERE novel_id=?').run(current.version + 1, novelId)
      archiveRemoved(this.db, before, novelId, 'reference', '资料引用：' + current.links.filter(old => !links.some(row => row.id === old.id)).map(row => row.label).join('、'))
      const result = this.snapshot(novelId)
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
}
