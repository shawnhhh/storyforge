import type { Novel } from './novels.js'

export interface DashboardChapter {
  id: string
  novelId: string
  novelTitle: string
  title: string
  updatedAt: string
  words: number
}
export interface DashboardNovel {
  novel: Novel
  chapters: number
  writtenChapters: number
  words: number
  continueChapterId: string | null
}
export interface WritingDay { day: string; words: number }
export interface WritingDashboard {
  novels: DashboardNovel[]
  recent: DashboardChapter[]
  totalWords: number
  totalChapters: number
  writtenChapters: number
  today: string
  todayWords: number
  dailyGoal: number
  streak: number
  longestStreak: number
  days: WritingDay[]
}
