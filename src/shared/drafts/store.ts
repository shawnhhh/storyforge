// Versioned browser-only recovery store. SQLite, backups and migrations are untouched.
export interface LocalDraft<T = unknown> {
  schema: 1
  id: string
  key: string
  token: string
  revision: number
  updatedAt: string
  base: string
  generation: string | null
  value: T
}
const prefix = 'storyforge:protected-draft:v1:'
const removedPrefix = 'storyforge:protected-draft:removed:v1:'
const journalKey = (value: LocalDraft) => `${prefix}${value.id}:${value.token}`
const tombstoneKey = (value: LocalDraft) => `${removedPrefix}${value.id}:${value.token}`
const numberTag = '\u0000storyforge-number'
// An unfinished numeric field is NaN. Plain JSON would turn it into null and
// make an otherwise complete form impossible to restore from the crash journal.
function encode(value: LocalDraft) {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'number' && !Number.isFinite(item) ? { [numberTag]: String(item) } : item)
}
function decode(value: string): unknown {
  return JSON.parse(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && Object.keys(item).length === 1 && numberTag in item) {
      const number = (item as Record<string, unknown>)[numberTag]
      if (number === 'NaN') return NaN
      if (number === 'Infinity') return Infinity
      if (number === '-Infinity') return -Infinity
    }
    return item
  })
}
let database: Promise<IDBDatabase> | undefined
function open() {
  if (!database) database = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('storyforge-protected-drafts', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' })
    request.onsuccess = () => { const db = request.result; db.onversionchange = () => { db.close(); database = undefined }; resolve(db) }
    request.onerror = () => { database = undefined; reject(request.error) }
    request.onblocked = () => { database = undefined; reject(new Error('浏览器草稿库被其他窗口占用')) }
  })
  return database
}
async function transact(action: (store: IDBObjectStore) => void) {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('草稿事务失败'))
    action(tx.objectStore('drafts'))
  })
}
function valid(value: unknown): value is LocalDraft {
  if (!value || typeof value !== 'object') return false
  const item = value as LocalDraft
  return item.schema === 1 && typeof item.id === 'string' && typeof item.key === 'string' && typeof item.token === 'string' && typeof item.base === 'string' && typeof item.updatedAt === 'string' && Number.isSafeInteger(item.revision) && item.revision >= 0 && (item.generation === null || typeof item.generation === 'string') && !!item.value && typeof item.value === 'object'
}
export async function readLocalDrafts<T>(key: string): Promise<LocalDraft<T>[]> {
  const records = new Map<string, LocalDraft>()
  let readable = false
  try {
    const db = await open()
    const values = await new Promise<unknown[]>((resolve, reject) => {
      const request = db.transaction('drafts').objectStore('drafts').getAll()
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    for (const value of values) { if (!valid(value)) throw new Error('本机草稿格式损坏，请保留浏览器数据并导出'); records.set(value.id, value) }
    readable = true
  } catch (error) { if (error instanceof Error && error.message.includes('格式损坏')) throw error }
  // Synchronous journal closes the input -> IndexedDB transaction crash window.
  // Also serves as fallback for Safari private-mode / unavailable IndexedDB.
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index)
      if (!name?.startsWith(prefix)) continue
      const value: unknown = decode(localStorage.getItem(name)!)
      if (!valid(value)) throw new Error('本机草稿格式损坏，请保留浏览器数据并导出')
      const prior = records.get(value.id)
      if (!prior || value.revision >= prior.revision) records.set(value.id, value)
    }
    for (const [id, record] of records) { if (localStorage.getItem(tombstoneKey(record)) === record.token || localStorage.getItem(removedPrefix + id) === record.token) records.delete(id) }
    readable = true
  } catch (error) { if (error instanceof Error && (error.message.includes('格式损坏') || error instanceof SyntaxError)) throw error }
  if (!readable) throw new Error('浏览器禁止读取本机草稿，请检查存储设置')
  return [...records.values()].filter(value => value.key === key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as LocalDraft<T>[]
}
export async function persistLocalDraft(value: LocalDraft) {
  let journaled = false
  try {
    localStorage.setItem(journalKey(value), encode(value)); journaled = true
    // Each token is immutable. Only this editor writes its id; once the new
    // revision is durable, its older journal keys are redundant.
    const older: string[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const name = localStorage.key(index)
      if (!name?.startsWith(`${prefix}${value.id}:`) || name === journalKey(value)) continue
      try {
        const prior = decode(localStorage.getItem(name)!) as LocalDraft
        if (prior.id === value.id && prior.revision < value.revision) older.push(name)
      } catch { /* Preserve unreadable records for manual recovery. */ }
    }
    older.forEach(name => localStorage.removeItem(name))
  } catch { /* IndexedDB can still protect large drafts. */ }
  try { await transact(store => { store.put(value) }) }
  catch { if (!journaled) throw new Error('本机草稿存储失败（空间不足或存储被禁用），请立即导出草稿') }
}
export async function removeLocalDraft(value: LocalDraft) {
  let removed = false
  try {
    await transact(store => {
      const request = store.get(value.id)
      request.onsuccess = () => { if (request.result?.token === value.token) store.delete(value.id) }
    })
    removed = true
  } catch { /* Keep the unavailable store suppressed with a token tombstone below. */ }
  // If IndexedDB is temporarily unavailable, a token tombstone prevents its
  // older copy from reappearing once the database becomes readable again.
  if (!removed) localStorage.setItem(tombstoneKey(value), value.token)
  try {
    // Unlike a mutable id key, deleting this exact token key cannot race with
    // another window persisting a newer revision of the original editor.
    localStorage.removeItem(journalKey(value))
    if (removed && localStorage.getItem(tombstoneKey(value)) === value.token) localStorage.removeItem(tombstoneKey(value))
    // Older development builds used a mutable key. Suppress that mirror without
    // removing a value that its original window might concurrently replace.
    const legacy = localStorage.getItem(prefix + value.id)
    if (legacy && (decode(legacy) as LocalDraft).token === value.token) localStorage.setItem(removedPrefix + value.id, value.token)
  } catch (error) {
    // An inaccessible mirror may be offered for review on a later visit. Never
    // report the confirmed IndexedDB cleanup as a failure in IDB-only browsers.
    if (!removed) throw error
  }
}
// Server bookkeeping fields do not make an otherwise identical draft conflict.
export function fingerprint(value: unknown): string {
  const content = value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['version', 'updatedAt', 'createdAt'].includes(key))) : value
  return JSON.stringify(content, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    return item
  })
}
