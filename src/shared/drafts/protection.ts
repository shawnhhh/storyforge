import { serviceGeneration } from '../api/client.js'
import { fingerprint, persistLocalDraft, readLocalDrafts, removeLocalDraft, type LocalDraft } from './store.js'

export interface ProtectionState<T> { loading: boolean; candidates: LocalDraft<T>[]; protected: boolean; error: string }
export class DraftProtection<T extends object> {
  state: ProtectionState<T> = { loading: true, candidates: [], protected: false, error: '' }
  private listeners = new Set<(state: ProtectionState<T>) => void>()
  private current?: LocalDraft<T>
  private recovered?: LocalDraft<T>
  private pending = Promise.resolve()
  private loadRevision = 0
  private revision = 0
  private id = crypto.randomUUID()
  private base: string
  private key: string
  private template: T
  constructor(key: string, initial: T) { this.key = key; this.template = initial; this.base = fingerprint(initial) }
  subscribe(listener: (state: ProtectionState<T>) => void) { this.listeners.add(listener); listener(this.state); return () => { this.listeners.delete(listener) } }
  private publish(patch: Partial<ProtectionState<T>>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener(this.state)) }
  async load() {
    const revision = ++this.loadRevision
    try {
      const candidates = await readLocalDrafts<T>(this.key)
      if (revision === this.loadRevision) this.publish({ loading: false, candidates })
    } catch (error) { if (revision === this.loadRevision) this.publish({ loading: false, error: String(error) }) }
  }
  change(value: T) {
    const record: LocalDraft<T> = { schema: 1, id: this.id, revision: ++this.revision, token: crypto.randomUUID(), key: this.key, updatedAt: new Date().toISOString(), base: this.base, generation: serviceGeneration(), value }
    this.current = record
    this.publish({ protected: false })
    // Start persistence synchronously, before any network debounce or React effect.
    const write = persistLocalDraft(record)
    this.pending = write.then(() => { if (this.current?.token === record.token) this.publish({ protected: true, error: '' }) }, error => { this.publish({ protected: false, error: String(error) }) })
  }
  async saved(value: T) {
    const expected = fingerprint(value)
    const record = this.current
    const recovered = this.recovered
    await this.pending
    try {
      if (record && fingerprint(record.value) === expected) {
        await removeLocalDraft(record)
        if (this.current?.token === record.token) { this.current = undefined; this.publish({ protected: false }) }
      }
      if (recovered && record && fingerprint(record.value) === expected) { await removeLocalDraft(recovered); if (this.recovered === recovered) this.recovered = undefined }
      this.base = expected
    } catch (error) { this.publish({ error: String(error) }) }
  }
  validate(record: LocalDraft<T>) { if (!compatible(this.template, record.value)) throw new Error('草稿格式与编辑器不兼容，请先导出草稿') }
  recover(record: LocalDraft<T>) { ++this.loadRevision; this.recovered = record; this.publish({ candidates: this.state.candidates.filter(item => item.token !== record.token) }); return record.value }
  async discard(record: LocalDraft<T>) {
    try { await removeLocalDraft(record); ++this.loadRevision; this.publish({ candidates: this.state.candidates.filter(item => item.token !== record.token), error: '' }) }
    catch (error) { this.publish({ error: String(error) }) }
  }
  async discardWorking() {
    await this.pending
    if (this.current) await removeLocalDraft(this.current)
    if (this.recovered) await removeLocalDraft(this.recovered)
  }
  matchesBase(record: LocalDraft<T>) { return record.base === this.base && record.generation === serviceGeneration() }
  get blocked() { return this.state.loading || this.state.candidates.length > 0 }
}

function compatible(template: unknown, value: unknown): boolean {
  if (template === null) return true
  if (Array.isArray(template)) return Array.isArray(value)
  if (typeof template !== typeof value) return false
  if (typeof template === 'object') {
    if (!value) return false
    return Object.entries(template).every(([key, field]) => compatible(field, (value as Record<string, unknown>)[key]))
  }
  return true
}
