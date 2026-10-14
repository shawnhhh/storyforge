import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type { Chapter, ChapterResult } from '../../shared/contracts/novels.js'
import { ChapterSaver } from '../../src/features/novels/autosave.js'
import { ApiError } from '../../src/features/novels/api.js'
const chapter: Chapter = { id: 'chapter', novelId: 'novel', title: '一', position: 0, version: 1, updatedAt: '', contentSchemaVersion: 1, content: { type: 'doc' } }
const result = (version: number, title: string): ChapterResult => ({ chapter: { ...chapter, version, title }, novel: { id: 'novel', title: '', description: '', version, createdAt: '', updatedAt: '' } })
test('autosave serializes writes and queues edits with the newly returned version', async () => {
  const calls: number[] = []
  let finish!: (value: ChapterResult) => void
  const saver = new ChapterSaver(chapter, async (_id, version, title) => {
    calls.push(version)
    if (calls.length === 1) return new Promise(resolve => { finish = resolve })
    return result(version + 1, title)
  }, 60000)
  try {
    saver.change('第一次', { type: 'doc' })
    const pending = saver.flush()
    saver.change('第二次', { type: 'doc' })
    await saver.flush()
    assert.deepEqual(calls, [1])
    finish(result(2, '第一次'))
    await pending
    assert.equal(saver.state.dirty, true)
    await saver.flush()
    assert.deepEqual(calls, [1, 2])
    assert.equal(saver.state.status, 'saved')
    assert.equal(saver.state.dirty, false)
  } finally { saver.dispose() }
})
test('conflicts preserve dirty drafts and block automatic retries', async () => {
  let attempts = 0
  const saver = new ChapterSaver(chapter, async () => { attempts++; throw new ApiError(409, '版本冲突') }, 60000)
  try {
    saver.change('未保存正文', { type: 'doc' }); await saver.flush()
    assert.equal(saver.state.status, 'conflict'); assert.equal(saver.state.dirty, true)
    saver.change('继续保留草稿', { type: 'doc' }); await saver.flush()
    assert.equal(attempts, 1)
  } finally { saver.dispose() }
})
test('save errors retain the expected version and can be retried', async () => {
  let attempts = 0
  const saver = new ChapterSaver(chapter, async (_id, version, title) => {
    attempts++; assert.equal(version, 1)
    if (attempts === 1) throw new Error('服务离线')
    return result(2, title)
  }, 60000)
  try {
    saver.change('正文', { type: 'doc' }); await saver.flush()
    assert.equal(saver.state.status, 'failed'); assert.equal(saver.state.dirty, true)
    await saver.flush(); assert.equal(saver.state.status, 'saved')
  } finally { saver.dispose() }
})

test('unmount cancels pending writes and ignores edits on a disposed queue', async () => {
  let attempts = 0
  const saver = new ChapterSaver(chapter, async () => { attempts++; return result(2, '不应保存') }, 10)
  saver.change('待保存', { type: 'doc' })
  saver.dispose()
  saver.change('卸载后的事件', { type: 'doc' })
  await delay(30)
  await saver.flush()
  assert.equal(attempts, 0)
})

test('a disposed in-flight queue cannot publish stale results or start queued writes', async () => {
  let finish!: (value: ChapterResult) => void
  const saver = new ChapterSaver(chapter, () => new Promise(resolve => { finish = resolve }), 60000)
  const statuses: string[] = []
  saver.subscribe(state => statuses.push(state.status))
  saver.change('请求中的正文', { type: 'doc' })
  const saving = saver.flush()
  saver.change('排队的正文', { type: 'doc' })
  saver.dispose()
  const before = [...statuses]
  finish(result(2, '请求中的正文'))
  await saving
  assert.deepEqual(statuses, before)
  assert.equal(saver.state.dirty, true)
})

test('deletion in another window preserves the draft and stops retries', async () => {
  let attempts = 0
  const saver = new ChapterSaver(chapter, async () => { attempts++; throw new ApiError(404, '章节已被删除') }, 10)
  try {
    saver.change('保留草稿', { type: 'doc' })
    await saver.flush()
    saver.change('继续编辑', { type: 'doc' })
    await delay(30)
    await saver.flush()
    assert.equal(saver.state.status, 'conflict')
    assert.equal(saver.state.dirty, true)
    assert.equal(attempts, 1)
  } finally { saver.dispose() }
})

test('edits during a failing request do not silently trigger a timed retry', async () => {
  let fail!: (reason: Error) => void
  let attempts = 0
  const saver = new ChapterSaver(chapter, async () => {
    attempts++
    return new Promise((_resolve, reject) => { fail = reject })
  }, 20)
  try {
    saver.change('正文', { type: 'doc' })
    const saving = saver.flush()
    saver.change('最新正文', { type: 'doc' })
    fail(new Error('服务离线'))
    await saving
    await delay(50)
    assert.equal(attempts, 1)
    assert.equal(saver.state.status, 'failed')
    assert.equal(saver.state.dirty, true)
  } finally { saver.dispose() }
})

test('empty chapter titles remain dirty without writing and can be corrected', async () => {
  let attempts = 0
  const saver = new ChapterSaver(chapter, async (_id, version, title) => { attempts++; return result(version + 1, title) }, 60000)
  try {
    saver.change('  ', { type: 'doc' }); await saver.flush()
    assert.equal(attempts, 0)
    assert.equal(saver.state.status, 'failed')
    assert.equal(saver.state.dirty, true)
    saver.change('有效标题', { type: 'doc' }); await saver.flush()
    assert.equal(attempts, 1)
    assert.equal(saver.state.status, 'saved')
  } finally { saver.dispose() }
})
