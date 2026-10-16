import { Router } from 'express'
import type { DatabaseSync } from 'node:sqlite'
import { searchKinds, type SearchHit, type SearchKind, type SearchResults } from '../../../../shared/contracts/search.js'
import { HttpError } from '../novels/store.js'

// Read current SQLite rows directly: no stale index, duplicated documents or schema migration.
const documents = `
  SELECT id, id AS novel_id, 'novel' AS kind, title, description AS body FROM novels
  UNION ALL
  SELECT id, novel_id, 'chapter', title,
    COALESCE((SELECT group_concat(CASE
      WHEN key='text' AND type='text' THEN atom
      WHEN key='type' AND atom IN ('paragraph','heading','blockquote','codeBlock','listItem','hardBreak') THEN ' '
      ELSE '' END, '') FROM json_tree(chapters.content)), '') FROM chapters
  UNION ALL
  SELECT id, novel_id, 'character', name, category || ' ' ||
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(characters.tags)), '') || ' ' ||
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(characters.fields)), '') || ' ' ||
    COALESCE((SELECT group_concat(kind, ' ') FROM character_relations WHERE source_id=characters.id), '') FROM characters
  UNION ALL
  SELECT id, novel_id, 'world', name, description || ' ' || time_text || ' ' ||
    CASE category WHEN 'location' THEN '地点' WHEN 'organization' THEN '势力组织' WHEN 'power' THEN '力量体系' WHEN 'history' THEN '历史事件' ELSE '其他设定' END || ' ' ||
    COALESCE((SELECT group_concat(value, ' ') FROM json_each(world_entries.tags)), '') FROM world_entries
  UNION ALL
  SELECT id, novel_id, kind, json_extract(data, '$.title'),
    COALESCE(json_extract(data, '$.content'), '') || ' ' || COALESCE(json_extract(data, '$.summary'), '') || ' ' ||
    COALESCE(json_extract(data, '$.storyTime'), '') FROM planning_records
`

export function search(database: DatabaseSync, query: unknown, kind: unknown = '', novelId: unknown = '', offset: unknown = '0'): SearchResults {
  if (typeof query !== 'string' || query.length > 200 || typeof kind !== 'string' || (kind && !Object.hasOwn(searchKinds, kind)) || typeof novelId !== 'string' || novelId.length > 200 || typeof offset !== 'string' || !/^\d{1,6}$/.test(offset)) throw new HttpError(400, '搜索参数无效（关键词最多 200 字）')
  const term = query.trim()
  if (!term) return { hits: [], hasMore: false }
  const rows = database.prepare(`WITH documents AS (${documents})
    SELECT d.*, n.title AS novel_title FROM documents d JOIN novels n ON n.id=d.novel_id
    WHERE (?='' OR d.kind=?) AND (?='' OR d.novel_id=?)
      AND (instr(lower(d.title), lower(?))>0 OR instr(lower(d.body), lower(?))>0)
    ORDER BY CASE WHEN instr(lower(d.title), lower(?))>0 THEN 0 ELSE 1 END, n.title, d.kind, d.title, d.id
    LIMIT 51 OFFSET ?`).all(kind, kind, novelId, novelId, term, term, term, Number(offset))
  const hits: SearchHit[] = rows.slice(0, 50).map(row => {
    const body = String(row.body).replace(/\s+/g, ' ')
    const index = body.toLowerCase().indexOf(term.toLowerCase()), start = Math.max(0, index - 35)
    return { id: String(row.id), novelId: String(row.novel_id), novelTitle: String(row.novel_title), kind: row.kind as SearchKind, title: String(row.title), excerpt: `${start ? '…' : ''}${body.slice(start, start + 160)}${body.length > start + 160 ? '…' : ''}` }
  })
  return { hits, hasMore: rows.length > 50 }
}

export function searchRoutes(database: DatabaseSync) {
  const router = Router()
  router.get('/search', (req, res) => {
    if (Object.keys(req.query).some(key => !['q', 'kind', 'novelId', 'offset'].includes(key))) throw new HttpError(400, '搜索参数无效')
    res.setHeader('Cache-Control', 'no-store')
    res.json(search(database, req.query.q, req.query.kind ?? '', req.query.novelId ?? '', req.query.offset ?? '0'))
  })
  return router
}
