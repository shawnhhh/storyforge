import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { DraftProtection } from '../../src/shared/drafts/protection.js'
import { fingerprint, persistLocalDraft, readLocalDrafts, removeLocalDraft, type LocalDraft } from '../../src/shared/drafts/store.js'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true })
beforeEach(() => localStorage.clear())
const initial = { title: '虚构数据库版', content: '正文' }
const key = () => `test:${crypto.randomUUID()}`
async function settle<T extends object>(controller: DraftProtection<T>) {
  // Read transactions queue behind the writes we are verifying.
  await readLocalDrafts('none')
  await Promise.resolve()
  assert.equal(controller.state.error, '')
}
test('fingerprints ignore top-level server metadata and property insertion order', () => {
  assert.equal(fingerprint({ title: '甲', version: 1, updatedAt: 'a', fields: { b: 2, a: 1 } }), fingerprint({ fields: { a: 1, b: 2 }, title: '甲', version: 2, updatedAt: 'b' }))
  assert.notEqual(fingerprint({ fields: { version: 1 } }), fingerprint({ fields: { version: 2 } }))
})
test('input journals synchronously and survives a new controller without contacting any server', async () => {
  const entity = key(), controller = new DraftProtection(entity, initial)
  await controller.load(); controller.change({ ...initial, content: '断网输入' })
  assert.match(localStorage.getItem(localStorage.key(0)!)!, /断网输入/)
  await settle(controller)
  const reopened = new DraftProtection(entity, initial); await reopened.load()
  assert.equal(reopened.blocked, true); assert.equal(reopened.state.candidates[0].value.content, '断网输入')
})
test('database acknowledgement removes the exact saved draft from both stores', async () => {
  const entity = key(), controller = new DraftProtection(entity, initial), value = { ...initial, content: '已确认' }
  await controller.load(); controller.change(value); await controller.saved(value)
  assert.deepEqual(await readLocalDrafts(entity), []); assert.equal(localStorage.length, 0)
})
test('an old save response cannot delete input written while the request was in flight', async () => {
  const entity = key(), controller = new DraftProtection(entity, initial)
  const first = { ...initial, content: '请求中' }, second = { ...initial, content: '请求期间新输入' }
  await controller.load(); controller.change(first)
  const response = controller.saved(first); controller.change(second); await response
  assert.equal((await readLocalDrafts<typeof initial>(entity))[0].value.content, second.content)
  await controller.saved(second); assert.deepEqual(await readLocalDrafts(entity), [])
})
test('multiple windows and chapters retain independent drafts; saving one does not delete another', async () => {
  const entity = key(), otherEntity = key()
  const a = new DraftProtection(entity, initial), b = new DraftProtection(entity, initial), c = new DraftProtection(otherEntity, initial)
  await Promise.all([a.load(), b.load(), c.load()])
  a.change({ ...initial, content: '窗口甲' }); b.change({ ...initial, content: '窗口乙' }); c.change({ ...initial, content: '另一章' })
  await a.saved({ ...initial, content: '窗口甲' })
  assert.equal((await readLocalDrafts<typeof initial>(entity))[0].value.content, '窗口乙')
  assert.equal((await readLocalDrafts<typeof initial>(otherEntity))[0].value.content, '另一章')
})
test('recovery requires an explicit choice, retains the source until the edited recovery is saved', async () => {
  const entity = key(), a = new DraftProtection(entity, initial)
  await a.load(); a.change({ ...initial, content: '旧草稿' }); await settle(a)
  const reopened = new DraftProtection(entity, { ...initial, content: '数据库已变' }); await reopened.load()
  assert.equal(reopened.matchesBase(reopened.state.candidates[0]), false)
  const selected = reopened.state.candidates[0]
  reopened.recover(selected); reopened.change({ ...selected.value, content: '人工核对后编辑' })
  assert.equal((await readLocalDrafts(entity)).length, 2)
  await reopened.saved({ ...selected.value, content: '人工核对后编辑' })
  assert.deepEqual(await readLocalDrafts(entity), [])
})
test('discard uses a token comparison and cannot remove a newer revision with the same id', async () => {
  const record: LocalDraft = { schema: 1, revision: 1, id: crypto.randomUUID(), token: 'old', key: key(), updatedAt: '2026-01-01', base: '', generation: null, value: initial }
  await persistLocalDraft(record)
  await persistLocalDraft({ ...record, revision: 2, token: 'new', updatedAt: '2026-01-02' })
  await removeLocalDraft(record)
  assert.equal((await readLocalDrafts(record.key))[0].token, 'new')
})
test('IndexedDB transaction failure falls back to the synchronous journal', async () => {
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = () => { throw new Error('simulated blocked IndexedDB') }
  try {
    const entity = key(), controller = new DraftProtection(entity, initial)
    await controller.load(); controller.change(initial); await settle(controller)
    assert.equal(controller.state.protected, true)
    assert.equal((await readLocalDrafts(entity)).length, 1)
  } finally { IDBDatabase.prototype.transaction = original }
})
test('storage quota failure is visible and never claims protection', async () => {
  const original = IDBDatabase.prototype.transaction, storage = localStorage
  IDBDatabase.prototype.transaction = () => { throw new Error('disk full') }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem: () => { throw new Error('quota') } } })
  try {
    const controller = new DraftProtection(key(), initial)
    const failed = new Promise<void>(resolve => { controller.subscribe(state => { if (state.error) resolve() }) })
    controller.change(initial); await failed
    assert.equal(controller.state.protected, false)
    assert.match(controller.state.error, /存储失败/)
  } finally { IDBDatabase.prototype.transaction = original; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }) }
})

test('fallback cleanup leaves a token tombstone so stale IndexedDB copies never resurrect', async () => {
  const record: LocalDraft = { schema: 1, revision: 1, id: crypto.randomUUID(), token: 'fallback', key: key(), updatedAt: '2026-01-01', base: '', generation: null, value: initial }
  await persistLocalDraft(record)
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = () => { throw new Error('temporary browser failure') }
  try { await removeLocalDraft(record); assert.deepEqual(await readLocalDrafts(record.key), []) }
  finally { IDBDatabase.prototype.transaction = original }
  assert.deepEqual(await readLocalDrafts(record.key), [])
  await persistLocalDraft({ ...record, revision: 2, token: 'newer', updatedAt: '2026-01-02' })
  assert.equal((await readLocalDrafts(record.key))[0].token, 'newer')
})
test('restoration rejects incompatible payloads while preserving the recoverable source', async () => {
  const entity = key(), controller = new DraftProtection(entity, initial)
  const record: LocalDraft = { schema: 1, revision: 1, id: crypto.randomUUID(), token: 'broken', key: entity, updatedAt: '2026-01-01', base: '', generation: null, value: { title: 123 } }
  await persistLocalDraft(record); await controller.load()
  assert.throws(() => controller.validate(controller.state.candidates[0]), /不兼容/)
  assert.equal(controller.state.candidates.length, 1)
})

test('a clock rollback cannot let an older journal replace a newer IndexedDB revision', async () => {
  const record: LocalDraft = { schema: 1, revision: 1, id: crypto.randomUUID(), token: 'old', key: key(), updatedAt: '2026-12-01', base: '', generation: null, value: initial }
  await persistLocalDraft(record)
  const original = localStorage.setItem
  localStorage.setItem = () => { throw new Error('journal quota') }
  try { await persistLocalDraft({ ...record, revision: 2, token: 'new', updatedAt: '2026-01-01', value: { ...initial, content: '新版本' } }) }
  finally { localStorage.setItem = original }
  assert.equal((await readLocalDrafts(record.key))[0].token, 'new')
})

test('the synchronous fallback preserves unfinished numeric fields without turning NaN into null', async () => {
  const original = IDBDatabase.prototype.transaction
  IDBDatabase.prototype.transaction = () => { throw new Error('IndexedDB unavailable') }
  try {
    const entity = key(), controller = new DraftProtection(entity, { name: '虚构事件', sortOrder: 0, description: '' })
    await controller.load(); controller.change({ name: '虚构事件', sortOrder: NaN, description: '顺序未完成也必须保留正文' })
    const reopened = new DraftProtection(entity, { name: '虚构事件', sortOrder: 0, description: '' }); await reopened.load()
    const record = reopened.state.candidates[0]
    reopened.validate(record)
    assert.equal(Number.isNaN(record.value.sortOrder), true)
    assert.equal(record.value.description, '顺序未完成也必须保留正文')
  } finally { IDBDatabase.prototype.transaction = original }
})

test('IndexedDB-only browsers confirm a successful cleanup even when the journal cannot be accessed', async () => {
  const storage = localStorage
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('denied', 'SecurityError') } })
  try {
    const entity = key(), controller = new DraftProtection(entity, initial)
    await controller.load(); controller.change(initial); await settle(controller)
    assert.equal(controller.state.protected, true)
    await controller.saved(initial)
    assert.equal(controller.state.error, ''); assert.equal(controller.state.protected, false)
    assert.deepEqual(await readLocalDrafts(entity), [])
  } finally { Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }) }
})

test('a cross-window journal write during old acknowledgement cannot be removed by that acknowledgement', async () => {
  const originalTransaction = IDBDatabase.prototype.transaction, originalRemove = localStorage.removeItem
  IDBDatabase.prototype.transaction = () => { throw new Error('IndexedDB unavailable') }
  const record: LocalDraft = { schema: 1, revision: 1, id: crypto.randomUUID(), token: 'old', key: key(), updatedAt: '2026-01-01', base: '', generation: null, value: initial }
  const newer: LocalDraft = { ...record, revision: 2, token: 'new', value: { ...initial, content: '清理期间的新输入' } }
  try {
    await persistLocalDraft(record)
    let injected = false
    localStorage.removeItem = function (name) {
      if (!injected && name.startsWith('storyforge:protected-draft:v1:')) {
        injected = true
        void persistLocalDraft(newer)
      }
      originalRemove.call(this, name)
    }
    await removeLocalDraft(record)
    assert.equal((await readLocalDrafts<typeof initial>(record.key))[0].value.content, '清理期间的新输入')
  } finally { IDBDatabase.prototype.transaction = originalTransaction; localStorage.removeItem = originalRemove }
})
