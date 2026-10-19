import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyPlanning, type PlanningSnapshot } from '../../shared/contracts/planning.js'
import { fingerprint, type LocalDraft } from '../../src/shared/drafts/store.js'
import { assertPlanningRecovery } from '../../src/features/planning/recovery.js'
function fixture() {
  const current: PlanningSnapshot = { ...emptyPlanning(), novelId: 'isolated-novel', version: 4 }
  const value = structuredClone(current)
  value.plotlines.push({ id: 'unsaved-or-deleted', title: '需核对的虚构规划', kind: 'main', content: '完整保留草稿正文' })
  const source: LocalDraft<PlanningSnapshot> = { schema: 1, id: 'draft', key: `planning:${current.novelId}`, revision: 1, token: 'token', generation: 'current-service', updatedAt: '2026-10-18T00:00:00Z', value, base: fingerprint(current) }
  return { current, source }
}
test('planning recovery: a protected new record with an unchanged base survives a service restart', () => {
  const { current, source } = fixture()
  assert.doesNotThrow(() => assertPlanningRecovery(current, source, 'restarted-service'))
  assert.equal(source.value.plotlines[0].content, '完整保留草稿正文')
})
test('planning recovery: a current legacy draft can recover unsaved new records', () => {
  const { current, source } = fixture(); source.base = fingerprint(source.value)
  assert.doesNotThrow(() => assertPlanningRecovery(current, source, source.generation))
})
test('planning recovery: the first incomplete legacy plan remains recoverable across service changes', () => {
  const { current, source } = fixture(); current.version = 0; source.value.version = 0
  source.value.plotlines[0].title = ''; source.base = fingerprint(source.value)
  assert.doesNotThrow(() => assertPlanningRecovery(current, source, 'restarted-service'))
  assert.equal(source.value.plotlines[0].title, '')
})
test('planning recovery: obsolete absent IDs cannot be rebased when old purge history is unavailable', () => {
  const { current, source } = fixture(); source.base = fingerprint(source.value); source.value.version--
  const before = structuredClone(source)
  assert.throws(() => assertPlanningRecovery(current, source, source.generation), /数据库中不存在/)
  // Full-DB restore can rewind a version, so matching numbers alone are unsafe.
  source.value.version = current.version
  assert.throws(() => assertPlanningRecovery(current, source, 'restored-service'), /数据库中不存在/)
  source.value.version = before.value.version
  assert.deepEqual(source, before); assert.deepEqual(current.plotlines, [])
})
test('planning recovery: explicit recovery of existing records remains available after other edits', () => {
  const { current, source } = fixture(); current.plotlines = structuredClone(source.value.plotlines)
  source.base = 'different'; source.value.version--
  assert.doesNotThrow(() => assertPlanningRecovery(current, source, 'restarted-service'))
})
test('planning recovery: cross-novel candidates are rejected without changing their identities or source', () => {
  const { current, source } = fixture(); source.value.novelId = 'another-novel'
  const before = structuredClone(source)
  assert.throws(() => assertPlanningRecovery(current, source, source.generation), /其他作品/)
  assert.deepEqual(source, before)
})
