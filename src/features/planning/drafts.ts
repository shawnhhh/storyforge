import { validatePlanning } from '../../../shared/domain/planning'
import type { PlanningSnapshot } from '../../../shared/contracts/planning'
export interface PlanningDraft { snapshot: PlanningSnapshot; generation: string | null }
const key = (id: string) => `storyforge:planning:draft:${id}`
export function readDraft(id: string): PlanningDraft | null {
  let raw: string | null
  try { raw = localStorage.getItem(key(id)) }
  catch (error) { if (error instanceof DOMException && error.name === 'SecurityError') return null; throw error }
  if (!raw) return null
  const value = JSON.parse(raw) as PlanningDraft
  if (value.snapshot?.novelId !== id || !Number.isSafeInteger(value.snapshot.version) || !['outlines', 'plotlines', 'cards', 'foreshadows'].every(name => Array.isArray(value.snapshot[name as keyof PlanningSnapshot]))) throw new Error('本地草稿格式无效，请先导出浏览器存储中的草稿')
  validatePlanning(value.snapshot, true)
  return value
}
export function writeDraft(value: PlanningDraft) { localStorage.setItem(key(value.snapshot.novelId), JSON.stringify(value)) }
export function clearDraft(id: string) { localStorage.removeItem(key(id)) }
export function downloadDraft(value: PlanningSnapshot) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `StoryForge-规划草稿-${value.novelId}.json`; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
