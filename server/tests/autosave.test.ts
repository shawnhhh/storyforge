import test from 'node:test'
import assert from 'node:assert/strict'
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
