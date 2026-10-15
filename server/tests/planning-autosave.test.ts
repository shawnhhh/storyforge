import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { PlanningAutosave, type PlanningSaveStatus } from '../../src/features/planning/autosave.js'
import { emptyPlanning, type PlanningSnapshot } from '../../shared/contracts/planning.js'
const initial = (): PlanningSnapshot => ({ ...emptyPlanning(), novelId: 'novel-a', version: 0 })
const edit = (title: string): PlanningSnapshot => ({ ...initial(), outlines: [{ id: 'outline', title, content: '', kind: 'overall', parentId: null, chapterIds: [] }] })
function fixture(save: (value: PlanningSnapshot) => Promise<PlanningSnapshot>, paused = false) {
  const drafts: (PlanningSnapshot | null)[] = [], statuses: PlanningSaveStatus[] = [], versions: number[] = []
  const saver = new PlanningAutosave(initial(), { save, draft: value => drafts.push(value), status: value => statuses.push(value), version: value => versions.push(value) }, paused)
  return { saver, drafts, statuses, versions }
}
test('planning drafts persist immediately; writes serialize and queued changes receive the new version', async () => {
  const calls: PlanningSnapshot[] = []; let finish!: (value: PlanningSnapshot) => void
  const f = fixture(async value => { calls.push(value); return calls.length === 1 ? new Promise(resolve => { finish = resolve }) : { ...value, version: value.version + 1 } })
  try {
    f.saver.change(edit('第一次')); assert.equal(f.drafts[0]!.outlines[0].title, '第一次')
    const pending = f.saver.flush(); f.saver.change(edit('第二次')); await f.saver.flush()
    assert.equal(calls.length, 1)
    finish({ ...calls[0], version: 1 }); await pending; await f.saver.flush()
    assert.deepEqual(calls.map(value => value.version), [0, 1])
    assert.equal(calls[1].outlines[0].title, '第二次')
    assert.equal(f.drafts.at(-1), null); assert.equal(f.statuses.at(-1), 'saved')
  } finally { f.saver.dispose() }
})
test('Chinese composition persists a draft while deferring all saves until composition ends', async () => {
  let calls = 0
  const f = fixture(async value => { calls++; return { ...value, version: 1 } })
  try {
    f.saver.composition(true); f.saver.change(edit('中文组合输入')); await f.saver.flush()
    assert.equal(calls, 0); assert.equal(f.drafts[0]!.outlines[0].title, '中文组合输入')
    f.saver.composition(false); await f.saver.flush()
    assert.equal(calls, 1); assert.equal(f.statuses.at(-1), 'saved')
  } finally { f.saver.dispose() }
})
test('network errors preserve the latest draft and expected version for explicit retry', async () => {
  const calls: number[] = []
  const f = fixture(async value => { calls.push(value.version); if (calls.length === 1) throw new Error('offline'); return { ...value, version: 1 } })
  try {
    f.saver.change(edit('保留草稿')); await f.saver.flush()
    assert.equal(f.statuses.at(-1), 'failed'); assert.equal(f.drafts.at(-1)!.outlines[0].title, '保留草稿')
    await f.saver.flush(); assert.deepEqual(calls, [0, 0]); assert.equal(f.drafts.at(-1), null)
  } finally { f.saver.dispose() }
})
test('edits during a failing request do not cause an unattended retry', async () => {
  let fail!: (error: Error) => void; let calls = 0
  const f = fixture(() => { calls++; return new Promise((_resolve, reject) => { fail = reject }) })
  try {
    f.saver.change(edit('请求中')); const pending = f.saver.flush(); f.saver.change(edit('新草稿'))
    fail(new Error('offline')); await pending; await delay(750)
    assert.equal(calls, 1); assert.equal(f.drafts.at(-1)!.outlines[0].title, '新草稿')
  } finally { f.saver.dispose() }
})
test('409 and 404 keep the draft and stop retries, including subsequent edits', async () => {
  for (const status of [404, 409]) {
    let calls = 0
    const f = fixture(async () => { calls++; throw Object.assign(new Error('stale'), { status }) })
    try {
      f.saver.change(edit('冲突草稿')); await f.saver.flush(); f.saver.change(edit('继续编辑')); await f.saver.flush()
      assert.equal(calls, 1); assert.equal(f.statuses.at(-1), 'conflict'); assert.equal(f.drafts.at(-1)!.outlines[0].title, '继续编辑')
    } finally { f.saver.dispose() }
  }
})
test('restored stale drafts stay paused and disposed controllers cannot start writes or publish status', async () => {
  let calls = 0
  const f = fixture(async value => { calls++; return { ...value, version: 1 } }, true)
  f.saver.change(edit('旧会话草稿')); await f.saver.flush(); assert.equal(calls, 0)
  f.saver.dispose(); const before = f.drafts.length; f.saver.change(edit('卸载事件')); assert.equal(f.drafts.length, before)
  let finish!: (value: PlanningSnapshot) => void
  const inFlight = fixture(() => new Promise(resolve => { finish = resolve }))
  inFlight.saver.change(edit('先前请求')); const pending = inFlight.saver.flush(); inFlight.saver.change(edit('排队草稿')); inFlight.saver.dispose()
  const statuses = [...inFlight.statuses]
  finish({ ...edit('先前请求'), version: 1 }); await pending
  assert.deepEqual(inFlight.statuses, statuses); assert.equal(inFlight.drafts.at(-1)!.version, 1)
  assert.equal(inFlight.drafts.at(-1)!.outlines[0].title, '排队草稿')
})
