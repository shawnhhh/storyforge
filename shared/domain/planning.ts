import { cardStatuses, foreshadowStatuses, outlineKinds, type PlanningData } from '../contracts/planning.js'
export class PlanningValidationError extends Error {}
const fail = (message: string): never => { throw new PlanningValidationError(message) }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('规划数据格式无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 100000, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) return fail(`请输入${required ? '非空' : ''}文本，最多 ${max} 字符`)
  return value
}
function id(value: unknown): string { const result = text(value, 80, true); if (!/^[a-zA-Z0-9_-]+$/.test(result)) return fail('规划标识无效'); return result }
function ids(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 2000) return fail('关联列表无效')
  const result = value.map(id)
  if (new Set(result).size !== result.length) return fail('关联不能重复')
  return result
}
function option<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) return fail('规划类型或状态无效')
  return value as T
}
export function validatePlanning(value: unknown, allowIncompleteTitles = false): PlanningData {
  const input = object(value)
  const list = (key: string) => {
    const entries = input[key]
    if (!Array.isArray(entries) || entries.length > 2000) return fail('每类规划最多 2000 项')
    return entries.map(object)
  }
  const base = (row: Record<string, unknown>) => ({ id: id(row.id), title: text(row.title, 200, !allowIncompleteTitles), content: text(row.content) })
  const data: PlanningData = {
    outlines: list('outlines').map(row => ({ ...base(row), kind: option(row.kind, Object.keys(outlineKinds) as (keyof typeof outlineKinds)[]), parentId: row.parentId === null ? null : id(row.parentId), chapterIds: ids(row.chapterIds) })),
    plotlines: list('plotlines').map(row => ({ ...base(row), kind: option(row.kind, ['main', 'subplot', 'custom']) })),
    cards: list('cards').map(row => {
      if (row.timeOrder !== null && (typeof row.timeOrder !== 'number' || !Number.isSafeInteger(row.timeOrder) || Math.abs(row.timeOrder) > 1e9)) return fail('故事时间序号必须为 ±10亿以内整数')
      return { ...base(row), summary: text(row.summary, 4000), status: option(row.status, Object.keys(cardStatuses) as (keyof typeof cardStatuses)[]), plotlineId: row.plotlineId === null ? null : id(row.plotlineId), storyTime: text(row.storyTime, 200), timeOrder: row.timeOrder as number | null, chapterIds: ids(row.chapterIds) }
    }),
    foreshadows: list('foreshadows').map(row => ({ ...base(row), status: option(row.status, Object.keys(foreshadowStatuses) as (keyof typeof foreshadowStatuses)[]), chapterIds: ids(row.chapterIds), plantedChapterIds: ids(row.plantedChapterIds), plannedChapterIds: ids(row.plannedChapterIds), resolvedChapterIds: ids(row.resolvedChapterIds), cardIds: ids(row.cardIds) })),
  }
  const all = Object.values(data).flat().map(row => row.id)
  if (new Set(all).size !== all.length) return fail('规划标识不能重复')
  for (const outline of data.outlines) {
    const seen = new Set([outline.id]); let parent = outline.parentId
    while (parent !== null) {
      if (seen.has(parent)) return fail('大纲不能形成循环层级')
      seen.add(parent)
      if (seen.size > 64) return fail('大纲层级最多 64 层')
      const ancestor = data.outlines.find(item => item.id === parent)
      if (!ancestor) return fail('上级大纲不存在')
      parent = ancestor.parentId
    }
  }
  for (const card of data.cards) if (card.plotlineId && !data.plotlines.some(row => row.id === card.plotlineId)) return fail('剧情线不存在或属于其他作品')
  for (const hint of data.foreshadows) {
    if (hint.cardIds.some(card => !data.cards.some(row => row.id === card))) return fail('关联剧情卡片不存在或属于其他作品')
  }
  return data
}
