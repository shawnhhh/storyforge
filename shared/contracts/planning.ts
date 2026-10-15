export const outlineKinds = { overall: '总纲', volume: '分卷大纲', chapter: '章节大纲' } as const
export const cardStatuses = { idea: '构思中', planned: '已规划', writing: '写作中', done: '已完成' } as const
export const foreshadowStatuses = { unplanted: '未埋设', planted: '已埋设', advancing: '推进中', resolved: '已回收' } as const
export interface PlanningItem { id: string; title: string; content: string }
export interface Outline extends PlanningItem { kind: keyof typeof outlineKinds; parentId: string | null; chapterIds: string[] }
export interface Plotline extends PlanningItem { kind: 'main' | 'subplot' | 'custom' }
export interface PlotCard extends PlanningItem {
  summary: string; status: keyof typeof cardStatuses; plotlineId: string | null
  storyTime: string; timeOrder: number | null; chapterIds: string[]
}
export interface Foreshadow extends PlanningItem {
  status: keyof typeof foreshadowStatuses; plantedChapterIds: string[]
  plannedChapterIds: string[]; resolvedChapterIds: string[]; chapterIds: string[]; cardIds: string[]
}
export interface PlanningData { outlines: Outline[]; plotlines: Plotline[]; cards: PlotCard[]; foreshadows: Foreshadow[] }
export interface PlanningSnapshot extends PlanningData { novelId: string; version: number }
export const emptyPlanning = (): PlanningData => ({ outlines: [], plotlines: [], cards: [], foreshadows: [] })
