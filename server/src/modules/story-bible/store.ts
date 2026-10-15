import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Character, CharacterInput, WorldEntry, WorldInput, StoryBible } from '../../../../shared/contracts/story-bible.js'
import { HttpError } from '../novels/store.js'
import { characterInput, worldInput, version } from './validation.js'

type Kind = 'characters' | 'world'
const tables = { characters: 'characters', world: 'world_entries' } as const
const meta = 'id, novel_id AS novelId, name, category, tags, version, created_at AS createdAt, updated_at AS updatedAt'
export class StoryBibleStore {
  constructor(private db: DatabaseSync) {}
  private transaction<T>(operation: () => T) {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private novel(id: string) {
    if (!this.db.prepare('SELECT id FROM novels WHERE id=?').get(id)) throw new HttpError(404, '小说不存在')
  }
  private row(kind: Kind, novelId: string, id: string) {
    const row = this.db.prepare(`SELECT * FROM ${tables[kind]} WHERE novel_id=? AND id=?`).get(novelId, id)
    if (!row) throw new HttpError(404, '资料不存在，可能已在另一个窗口删除')
    return row
  }
  private check(kind: Kind, novelId: string, id: string, expected: unknown) {
    if (this.row(kind, novelId, id).version !== version(expected)) throw new HttpError(409, '资料已在另一个窗口更新。请导出草稿后重新加载，避免覆盖。')
  }
  list(novelId: string): StoryBible {
    return this.transaction(() => {
      this.novel(novelId)
      const relations = this.db.prepare('SELECT source_id,target_id,kind FROM character_relations WHERE novel_id=? ORDER BY target_id,kind').all(novelId)
      const links = this.db.prepare('SELECT character_id,world_id FROM character_world_links WHERE novel_id=? ORDER BY world_id').all(novelId)
      const characters = this.db.prepare(`SELECT ${meta},fields FROM characters WHERE novel_id=? ORDER BY created_at,id`).all(novelId).map(row => ({
        ...row, tags: JSON.parse(String(row.tags)), fields: JSON.parse(String(row.fields)),
        relations: relations.filter(item => item.source_id === row.id).map(item => ({ targetId: item.target_id, kind: item.kind })),
        worldIds: links.filter(item => item.character_id === row.id).map(item => item.world_id),
      })) as unknown as Character[]
      const world = this.db.prepare(`SELECT ${meta},description,time_text AS timeText,sort_order AS sortOrder,on_timeline AS onTimeline FROM world_entries WHERE novel_id=? ORDER BY sort_order,created_at,id`).all(novelId).map(row => ({ ...row, tags: JSON.parse(String(row.tags)), onTimeline: row.onTimeline === 1 })) as unknown as WorldEntry[]
      return { characters, world }
    })
  }
  private links(novelId: string, id: string, data: CharacterInput) {
    for (const relation of data.relations) {
      if (relation.targetId === id || !this.db.prepare('SELECT id FROM characters WHERE novel_id=? AND id=?').get(novelId, relation.targetId)) throw new HttpError(400, '人物关系必须指向同一本小说中的其他人物')
    }
    for (const worldId of data.worldIds) {
      if (!this.db.prepare('SELECT id FROM world_entries WHERE novel_id=? AND id=?').get(novelId, worldId)) throw new HttpError(400, '关联设定必须属于同一本小说且仍然存在')
    }
    this.db.prepare('DELETE FROM character_relations WHERE novel_id=? AND source_id=?').run(novelId, id)
    this.db.prepare('DELETE FROM character_world_links WHERE novel_id=? AND character_id=?').run(novelId, id)
    for (const relation of data.relations) this.db.prepare('INSERT INTO character_relations VALUES (?,?,?,?)').run(novelId, id, relation.targetId, relation.kind)
    for (const worldId of data.worldIds) this.db.prepare('INSERT INTO character_world_links VALUES (?,?,?)').run(novelId, id, worldId)
  }
  saveCharacter(novelId: string, value: unknown, id?: string, expected?: unknown): Character {
    const data = characterInput(value)
    const recordId = id ?? randomUUID(), now = new Date().toISOString()
    this.transaction(() => {
      this.novel(novelId)
      if (id) {
        this.check('characters', novelId, id, expected)
        this.db.prepare('UPDATE characters SET name=?,category=?,tags=?,fields=?,version=version+1,updated_at=? WHERE novel_id=? AND id=?').run(data.name, data.category, JSON.stringify(data.tags), JSON.stringify(data.fields), now, novelId, id)
      } else this.db.prepare('INSERT INTO characters(id,novel_id,name,category,tags,fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(recordId, novelId, data.name, data.category, JSON.stringify(data.tags), JSON.stringify(data.fields), now, now)
      this.links(novelId, recordId, data)
    })
    return this.list(novelId).characters.find(row => row.id === recordId)!
  }
  saveWorld(novelId: string, value: unknown, id?: string, expected?: unknown): WorldEntry {
    const data: WorldInput = worldInput(value)
    const recordId = id ?? randomUUID(), now = new Date().toISOString()
    this.transaction(() => {
      this.novel(novelId)
      const values = [data.name, data.category, JSON.stringify(data.tags), data.description, data.timeText, data.sortOrder, Number(data.onTimeline)]
      if (id) {
        this.check('world', novelId, id, expected)
        this.db.prepare('UPDATE world_entries SET name=?,category=?,tags=?,description=?,time_text=?,sort_order=?,on_timeline=?,version=version+1,updated_at=? WHERE novel_id=? AND id=?').run(...values, now, novelId, id)
      } else this.db.prepare('INSERT INTO world_entries(name,category,tags,description,time_text,sort_order,on_timeline,id,novel_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...values, recordId, novelId, now, now)
    })
    return this.list(novelId).world.find(row => row.id === recordId)!
  }
  remove(kind: Kind, novelId: string, id: string, expected: unknown) {
    this.transaction(() => {
      this.check(kind, novelId, id, expected)
      // Invalidate editors whose outgoing associations will be removed by CASCADE.
      // Otherwise a stale editor could silently recreate a deleted association.
      const sources = kind === 'characters'
        ? this.db.prepare('SELECT source_id AS id FROM character_relations WHERE novel_id=? AND target_id=?').all(novelId, id)
        : this.db.prepare('SELECT character_id AS id FROM character_world_links WHERE novel_id=? AND world_id=?').all(novelId, id)
      for (const sourceId of new Set(sources.map(row => String(row.id)))) this.db.prepare('UPDATE characters SET version=version+1,updated_at=? WHERE novel_id=? AND id=?').run(new Date().toISOString(), novelId, sourceId)
      this.db.prepare(`DELETE FROM ${tables[kind]} WHERE novel_id=? AND id=?`).run(novelId, id)
    })
  }
}
