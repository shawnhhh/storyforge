import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'
import { forceCloseDatabase } from 'fake-indexeddb'
import { persistLocalDraft, readLocalDrafts, type LocalDraft } from '../../src/shared/drafts/store.js'

// No journal: a failed IndexedDB connection must really recover on the next call.
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { setItem() { throw new Error('disabled') }, get length() { throw new Error('disabled') } } })
const record = (): LocalDraft => ({ schema: 1, id: crypto.randomUUID(), key: crypto.randomUUID(), token: crypto.randomUUID(), revision: 1, updatedAt: new Date().toISOString(), base: '', generation: null, value: { content: '仅在本机保护' } })

async function closeCachedConnection() {
  const original = IDBDatabase.prototype.transaction
  const connections = new Set<IDBDatabase>()
  IDBDatabase.prototype.transaction = function (...args: Parameters<typeof original>) { connections.add(this); return original.apply(this, args) }
  try { await readLocalDrafts('none') } finally { IDBDatabase.prototype.transaction = original }
  const [connection] = connections
  assert.ok(connection)
  const closed = new Promise<void>(resolve => connection!.addEventListener('close', () => resolve(), { once: true }))
  forceCloseDatabase(connection as unknown as Parameters<typeof forceCloseDatabase>[0])
  await closed
}

test('a synchronous open failure does not poison later IndexedDB-only recovery', async () => {
  const original = indexedDB.open
  indexedDB.open = () => { throw new DOMException('temporarily denied', 'SecurityError') }
  try { await assert.rejects(readLocalDrafts('none'), /禁止读取/) }
  finally { indexedDB.open = original }
  const draft = record()
  await persistLocalDraft(draft)
  assert.deepEqual(await readLocalDrafts(draft.key), [draft])
  await closeCachedConnection()
})

test('a blocked open that succeeds late is closed without evicting a newer connection', async () => {
  const originalOpen = indexedDB.open, originalClose = IDBDatabase.prototype.close
  let release!: () => void
  let lateConnection: IDBDatabase | undefined
  const closed: IDBDatabase[] = []
  const captured = new Promise<void>(resolve => {
    indexedDB.open = function (...args: Parameters<typeof originalOpen>) {
      const request = originalOpen.apply(this, args)
      queueMicrotask(() => request.onblocked!.call(request, new Event('blocked') as IDBVersionChangeEvent))
      request.addEventListener('success', () => {
        lateConnection = request.result
        const callback = request.onsuccess!
        request.onsuccess = null
        release = () => callback.call(request, new Event('success'))
        resolve()
      })
      return request
    }
  })
  IDBDatabase.prototype.close = function () { closed.push(this); return originalClose.call(this) }
  try {
    await assert.rejects(readLocalDrafts('none'), /禁止读取/)
    await captured
    indexedDB.open = originalOpen
    const draft = record()
    await persistLocalDraft(draft)
    release()
    assert.ok(closed.includes(lateConnection!))
    let extraOpens = 0
    indexedDB.open = function (...args: Parameters<typeof originalOpen>) { extraOpens++; return originalOpen.apply(this, args) }
    assert.deepEqual(await readLocalDrafts(draft.key), [draft])
    assert.equal(extraOpens, 0)
  } finally { indexedDB.open = originalOpen; IDBDatabase.prototype.close = originalClose; lateConnection?.close() }
  await closeCachedConnection()
})
