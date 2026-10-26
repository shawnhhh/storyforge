import { archiveRemoved, snapshot } from '../trash/store.js'
import { countDocument } from '../../../../shared/domain/word-count.js'
import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Chapter, ChapterResult, ChapterSummary, Novel, NovelDetail, RichTextDocument } from '../../../../shared/contracts/novels.js'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const novelColumns = 'id, title, description, version, created_at AS createdAt, updated_at AS updatedAt'
const chapterColumns = 'id, novel_id AS novelId, title, position, version, created_at AS createdAt, updated_at AS updatedAt, content, content_schema_version AS contentSchemaVersion'

export class NovelStore {
  private tracksWriting: boolean
  constructor(private db: DatabaseSync) {
    // Legacy backup fixtures can still use this store before their v3 upgrade.
    this.tracksWriting = !!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='writing_days'").get()
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try { const result = operation(); this.db.exec('COMMIT'); return result }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  list(): Novel[] { return this.db.prepare(`SELECT ${novelColumns} FROM novels ORDER BY updated_at DESC, id`).all() as unknown as Novel[] }
  novel(id: string): Novel {
    const row = this.db.prepare(`SELECT ${novelColumns} FROM novels WHERE id = ?`).get(id)
    if (!row) throw new HttpError(404, '小说不存在，可能已在另一个窗口删除')
    return row as unknown as Novel
  }
  revision(id: string) {
    const novel = this.novel(id), digest = createHash('sha256')
    for (const row of this.db.prepare('SELECT id,version,position FROM chapters WHERE novel_id=? ORDER BY id').iterate(id)) digest.update(JSON.stringify([row.id, row.version, row.position]))
    return { novel, chapters: digest.digest('hex') }
  }
  chapter(id: string): Chapter {
    const row = this.db.prepare(`SELECT ${chapterColumns} FROM chapters WHERE id = ?`).get(id)
    if (!row) throw new HttpError(404, '章节不存在，可能已在另一个窗口删除')
    return { ...row, content: JSON.parse(String(row.content)) } as unknown as Chapter
  }
  detail(id: string): NovelDetail {
    const novel = this.novel(id)
    const chapters = this.db.prepare('SELECT id, novel_id AS novelId, title, position, version, updated_at AS updatedAt FROM chapters WHERE novel_id = ? ORDER BY position, id').all(id) as unknown as ChapterSummary[]
    return { novel, chapters }
  }
  exportData(id: string) {
    // A read transaction keeps metadata and every chapter in one SQLite snapshot,
    // including when another connection commits while this connection reads.
    this.db.exec('BEGIN')
    try {
      const detail = this.detail(id)
      const result = { novel: detail.novel, chapters: detail.chapters.map(chapter => this.chapter(chapter.id)) }
      this.db.exec('COMMIT')
      return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  private check(actual: number, expected: number) {
    if (actual !== expected) throw new HttpError(409, '数据已在另一个窗口更新。当前修改尚未保存，请复制内容后重新加载。')
  }
  private touch(id: string) {
    this.db.prepare('UPDATE novels SET version = version + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), id)
  }
  create(title: string, description: string) {
    const id = randomUUID(), now = new Date().toISOString()
    this.db.prepare('INSERT INTO novels(id,title,description,created_at,updated_at) VALUES (?,?,?,?,?)').run(id, title, description, now, now)
    return this.novel(id)
  }
  update(id: string, expected: number, title: string, description: string) {
    return this.transaction(() => {
      this.check(this.novel(id).version, expected)
      this.db.prepare('UPDATE novels SET title=?, description=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(title, description, new Date().toISOString(), id, expected)
      return this.novel(id)
    })
  }
  remove(id: string, expected: number) {
    this.transaction(() => { const novel = this.novel(id); this.check(novel.version, expected); const before = snapshot(this.db, id); this.db.prepare('DELETE FROM novels WHERE id=? AND version=?').run(id, expected); archiveRemoved(this.db, before, id, 'novel', novel.title) })
  }
  createChapter(novelId: string, expected: number, title: string): ChapterResult {
    return this.transaction(() => {
      this.check(this.novel(novelId).version, expected)
      const id = randomUUID(), now = new Date().toISOString()
      const position = Number(this.db.prepare('SELECT COALESCE(MAX(position), -1)+1 AS position FROM chapters WHERE novel_id=?').get(novelId)!.position)
      this.db.prepare('INSERT INTO chapters(id,novel_id,title,content,position,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, novelId, title, JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] }), position, now, now)
      this.touch(novelId)
      return { chapter: this.chapter(id), novel: this.novel(novelId) }
    })
  }
  saveChapter(id: string, expected: number, title: string, content: RichTextDocument): ChapterResult {
    return this.transaction(() => {
      const chapter = this.chapter(id)
      this.check(chapter.version, expected)
      this.db.prepare('UPDATE chapters SET title=?, content=?, version=version+1, updated_at=? WHERE id=? AND version=?').run(title, JSON.stringify(content), new Date().toISOString(), id, expected)
      const added = Math.max(0, countDocument(content) - countDocument(chapter.content))
      if (this.tracksWriting && added > 0) {
        this.db.prepare('INSERT INTO writing_days(day, words) VALUES (?, ?) ON CONFLICT(day) DO UPDATE SET words=words+excluded.words').run(new Date().toISOString().slice(0, 10), added)
      }
      this.touch(chapter.novelId)
      return { chapter: this.chapter(id), novel: this.novel(chapter.novelId) }
    })
  }
  removeChapter(id: string, expected: number, expectedNovel: number) {
    return this.transaction(() => {
      const chapter = this.chapter(id)
      this.check(chapter.version, expected)
      this.check(this.novel(chapter.novelId).version, expectedNovel)
      const before = snapshot(this.db, chapter.novelId, ['planning_chapter_links', 'knowledge_links'])
      before.chapters = [this.db.prepare('SELECT * FROM chapters WHERE id=?').get(id)!]
      this.db.prepare('DELETE FROM chapters WHERE id=? AND version=?').run(id, expected)
      archiveRemoved(this.db, before, chapter.novelId, 'chapter', chapter.title)
      this.db.prepare('UPDATE chapters SET position=position-1 WHERE novel_id=? AND position>?').run(chapter.novelId, chapter.position)
      this.touch(chapter.novelId)
      return this.detail(chapter.novelId)
    })
  }
  reorder(id: string, expected: number, ids: string[]) {
    return this.transaction(() => {
      this.check(this.novel(id).version, expected)
      const current = this.detail(id).chapters.map(row => String(row.id))
      if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some(item => !current.includes(item))) throw new HttpError(400, '排序必须包含当前小说的全部章节且不能重复')
      const update = this.db.prepare('UPDATE chapters SET position=? WHERE novel_id=? AND id=?')
      ids.forEach((chapterId, position) => update.run(position, id, chapterId))
      this.touch(id)
      return this.detail(id)
    })
  }
}
