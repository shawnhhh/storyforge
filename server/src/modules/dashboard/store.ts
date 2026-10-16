import type { DatabaseSync } from 'node:sqlite'
import type { RichTextDocument } from '../../../../shared/contracts/novels.js'
import type { DashboardChapter, WritingDashboard, WritingDay } from '../../../../shared/contracts/dashboard.js'
import { countDocument } from '../../../../shared/domain/word-count.js'
import { HttpError, NovelStore } from '../novels/store.js'

const dayAt = (today: string, offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10)
export function writingHistory(history: WritingDay[], today: string) {
  const active = new Set(history.filter(row => row.words > 0 && row.day <= today).map(row => row.day))
  let streak = 0, longestStreak = 0, run = 0, previous = ''
  for (const day of [...active].sort()) {
    run = previous && dayAt(previous, 1) === day ? run + 1 : 1
    longestStreak = Math.max(longestStreak, run); previous = day
  }
  let cursor = active.has(today) ? today : dayAt(today, -1)
  while (active.has(cursor)) { streak++; cursor = dayAt(cursor, -1) }
  return { streak, longestStreak, days: Array.from({ length: 14 }, (_, index) => {
    const day = dayAt(today, index - 13)
    return { day, words: history.find(row => row.day === day)?.words ?? 0 }
  }) }
}
export class DashboardStore {
  constructor(private db: DatabaseSync) {}
  read(now = new Date()): WritingDashboard {
    this.db.exec('BEGIN')
    try {
      const novels = new NovelStore(this.db).list()
      const chapters = this.db.prepare(`SELECT c.id, c.novel_id AS novelId, n.title AS novelTitle, c.title, c.updated_at AS updatedAt, c.content
        FROM chapters c JOIN novels n ON n.id=c.novel_id ORDER BY c.updated_at DESC, c.id`).all()
        .map(row => ({ id: String(row.id), novelId: String(row.novelId), novelTitle: String(row.novelTitle), title: String(row.title), updatedAt: String(row.updatedAt), words: countDocument(JSON.parse(String(row.content)) as RichTextDocument) } satisfies DashboardChapter))
      const byNovel = new Map<string, DashboardChapter[]>()
      for (const chapter of chapters) {
        const group = byNovel.get(chapter.novelId) ?? []
        group.push(chapter); byNovel.set(chapter.novelId, group)
      }
      const today = now.toISOString().slice(0, 10)
      const history = this.db.prepare('SELECT day, words FROM writing_days WHERE day <= ? ORDER BY day').all(today) as unknown as WritingDay[]
      const result: WritingDashboard = {
        novels: novels.map(novel => {
          const rows = byNovel.get(novel.id) ?? []
          return { novel, chapters: rows.length, writtenChapters: rows.filter(row => row.words > 0).length, words: rows.reduce((sum, row) => sum + row.words, 0), continueChapterId: rows[0]?.id ?? null }
        }),
        recent: chapters.slice(0, 5), totalWords: chapters.reduce((sum, row) => sum + row.words, 0), totalChapters: chapters.length,
        writtenChapters: chapters.filter(row => row.words > 0).length, today, todayWords: history.find(row => row.day === today)?.words ?? 0,
        dailyGoal: Number(this.db.prepare('SELECT daily_goal FROM writing_settings WHERE id=1').get()!.daily_goal),
        ...writingHistory(history, today),
      }
      this.db.exec('COMMIT'); return result
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  setGoal(value: unknown) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 1000000) throw new HttpError(400, '每日目标需为 1 至 1,000,000 的整数')
    this.db.prepare('UPDATE writing_settings SET daily_goal=? WHERE id=1').run(value)
    return { dailyGoal: value }
  }
}
