import type { PlanningSnapshot } from '../../../shared/contracts/planning.js'
import { fingerprint, type LocalDraft } from '../../shared/drafts/store.js'

// Pre-v6 permanently purged IDs cannot be reconstructed from an empty archive.
// Only reintroduce absent records from a verifiable base or a current legacy
// revision; otherwise keep the original candidate for review/export.
export function assertPlanningRecovery(current: PlanningSnapshot, source: LocalDraft<PlanningSnapshot>, generation: string | null) {
  if (source.value.novelId !== current.novelId || source.key !== `planning:${current.novelId}`) throw new Error('草稿属于其他作品，请先导出核对，不能覆盖当前作品')
  const records = (value: PlanningSnapshot) => [...value.outlines, ...value.plotlines, ...value.cards, ...value.foreshadows]
  const existing = new Set(records(current).map(row => row.id))
  const hasAbsent = records(source.value).some(row => !existing.has(row.id))
  const trustedBase = source.base === fingerprint(current)
  const currentLegacyRevision = generation !== null && source.generation === generation && source.value.version === current.version
  // Preserve the original legacy migration contract for the first unsaved plan.
  // A workspace with persisted/deleted plans has a nonzero aggregate version.
  const firstLegacyDraft = current.version === 0 && source.value.version === 0 && existing.size === 0
  if (hasAbsent && !trustedBase && !currentLegacyRevision && !firstLegacyDraft) throw new Error('草稿包含数据库中不存在的规划，旧版本删除历史或基准已变化，无法确认能否安全恢复。草稿已保留，请导出核对；已删除对象请从回收站恢复。')
}
