import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import type { Character, WorldEntry } from '../../shared/contracts/story-bible.js'
import { ProfileSaver } from '../../src/features/story-bible/autosave.js'
import { matchesProfile, newCharacter, newWorld, timelineEntries, validateProfile } from '../../src/features/story-bible/model.js'
import { ApiError } from '../../src/shared/api/client.js'

const character: Character = { ...newCharacter(), id: 'character', novelId: 'novel', version: 1, createdAt: '', updatedAt: '' }
const world: WorldEntry = { ...newWorld(), id: 'world', novelId: 'novel', version: 1, createdAt: '', updatedAt: '' }

test('profile autosave serializes immutable snapshots and uses the returned version for queued edits', async () => {
  const calls: Character[] = []
  let finish!: (value: Character) => void
  const saver = new ProfileSaver(character, async value => {
    calls.push(value)
    if (calls.length === 1) return new Promise(resolve => { finish = resolve })
    return { ...value, version: value.version + 1 }
  }, validateProfile, 60000)
  try {
    saver.change({ ...character, name: '林月 <&> 🌕', tags: ['主角'] })
    const first = saver.flush()
    saver.change({ ...character, name: '林月·第二稿', fields: { ...character.fields, background: '中文\n特殊字符 " \\ <>&' } })
    await saver.flush()
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, '林月 <&> 🌕')
    finish({ ...calls[0], version: 2 }); await first
    assert.equal(saver.state.dirty, true)
    await saver.flush()
    assert.equal(calls[1].version, 2)
    assert.equal(calls[1].name, '林月·第二稿')
    assert.equal(calls[1].fields.background, '中文\n特殊字符 " \\ <>&')
    assert.equal(saver.state.status, 'saved'); assert.equal(saver.state.dirty, false)
  } finally { saver.dispose() }
})

for (const status of [404, 409]) test(`profile ${status} preserves the draft and stops all retries`, async () => {
  let calls = 0
  const saver = new ProfileSaver(character, async () => { calls++; throw new ApiError(status, '远端资料变化') }, validateProfile, 5)
  try {
    saver.change({ ...character, name: '保留草稿' }); await saver.flush()
    saver.change({ ...character, name: '冲突后继续编辑' }); await saver.flush(); await delay(20)
    assert.equal(saver.state.status, 'conflict'); assert.equal(saver.state.dirty, true); assert.equal(calls, 1)
  } finally { saver.dispose() }
})

test('a failed in-flight request cancels queued retries and manual retry sends the latest draft with the original version', async () => {
  let fail!: (reason: Error) => void
  const calls: WorldEntry[] = []
  const saver = new ProfileSaver(world, async value => {
    calls.push(value)
    if (calls.length === 1) return new Promise((_resolve, reject) => { fail = reject })
    return { ...value, version: 2 }
  }, validateProfile, 10)
  try {
    saver.change({ ...world, description: '第一稿' }); const saving = saver.flush()
    saver.change({ ...world, description: '离线期间继续编辑' }); fail(new Error('服务离线'))
    await saving; await delay(30)
    assert.equal(calls.length, 1); assert.equal(saver.state.status, 'failed')
    await saver.flush()
    assert.equal(calls[1].version, 1); assert.equal(calls[1].description, '离线期间继续编辑')
    assert.equal(saver.state.dirty, false)
  } finally { saver.dispose() }
})

test('empty names and invalid timeline orders remain dirty until corrected', async () => {
  let calls = 0
  const saver = new ProfileSaver(world, async value => { calls++; return { ...value, version: 2 } }, validateProfile, 60000)
  try {
    for (const patch of [{ name: '  ' }, { sortOrder: NaN }, { sortOrder: 1.5 }, { sortOrder: 1e10 }]) {
      saver.change({ ...world, ...patch }); await saver.flush()
      assert.equal(saver.state.status, 'failed'); assert.equal(saver.state.dirty, true)
    }
    assert.equal(calls, 0)
    saver.change({ ...world, name: '开元', sortOrder: -3 }); await saver.flush()
    assert.equal(calls, 1); assert.equal(saver.state.dirty, false)
  } finally { saver.dispose() }
})

test('Chinese IME composition delays saving until composition ends', async () => {
  const calls: Character[] = []
  const saver = new ProfileSaver(character, async value => { calls.push(value); return { ...value, version: 2 } }, validateProfile, 5)
  try {
    saver.composition(true); saver.change({ ...character, name: 'lin' }); await saver.flush(); await delay(15)
    assert.equal(calls.length, 0); assert.equal(saver.state.dirty, true)
    saver.change({ ...character, name: '林' }); saver.composition(false); await saver.flush()
    assert.equal(calls[0].name, '林'); assert.equal(saver.state.dirty, false)
  } finally { saver.dispose() }
})

test('unmount cancels scheduled writes and ignores stale in-flight results', async () => {
  let finish!: (value: Character) => void
  let calls = 0
  const saver = new ProfileSaver(character, async () => { calls++; return new Promise(resolve => { finish = resolve }) }, validateProfile, 5)
  const states: string[] = []
  saver.subscribe(state => states.push(state.status))
  saver.change({ ...character, name: '请求中' }); const saving = saver.flush()
  saver.change({ ...character, name: '排队中' }); saver.dispose()
  const before = [...states]
  finish({ ...character, version: 2 }); await saving; await delay(15)
  saver.change(character); await saver.flush()
  assert.deepEqual(states, before); assert.equal(calls, 1)
  const pending = new ProfileSaver(character, async value => { calls++; return value }, validateProfile, 5)
  pending.change({ ...character, name: '待保存' }); pending.dispose(); await delay(15)
  assert.equal(calls, 1)
})

test('search combines literal Unicode text, custom category and exact tags; timeline sorts by explicit order', () => {
  const person = { ...character, name: '林月🌕', category: '主角', tags: ['家族 <&>'], fields: { ...character.fields, aliases: 'ALICE', arc: '重拾勇气' } }
  assert.equal(matchesProfile(person, 'alice', '家族 <&>', '主角'), true)
  assert.equal(matchesProfile(person, '勇气', '', ''), true)
  assert.equal(matchesProfile(person, '<&>', '', ''), true)
  assert.equal(matchesProfile(person, '林', '家族', ''), false)
  assert.equal(matchesProfile(person, '林', '', '反派'), false)
  const event = { ...world, category: 'history' as const, onTimeline: true, timeText: '上古·冬', sortOrder: 10 }
  assert.equal(matchesProfile(event, '历史事件', '', 'history'), true)
  assert.equal(matchesProfile(event, '上古', '', ''), true)
  assert.deepEqual(timelineEntries([{ ...event, id: 'b' }, { ...event, id: 'a' }, { ...event, id: 'first', sortOrder: -1 }, world]).map(item => item.id), ['first', 'a', 'b'])
})
