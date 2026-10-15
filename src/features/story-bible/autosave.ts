import { ApiError } from '../../shared/api/client.js'
import type { RecordMeta } from '../../../shared/contracts/story-bible.js'

export interface SaveState {
  status: 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'
  dirty: boolean
  message: string
}
// Each editor owns one queue. Values are immutable snapshots; only the version
// returned by the server is used for the next request. Conflicts never retry.
export class ProfileSaver<T extends RecordMeta> {
  state: SaveState = { status: 'saved', dirty: false, message: '' }
  private value: T
  private version: number
  private revision = 0
  private savedRevision = 0
  private running = false
  private disposed = false
  private composing = false
  private timer?: ReturnType<typeof setTimeout>
  private listeners = new Set<(state: SaveState, result?: T) => void>()
  private save: (value: T) => Promise<T>
  private delay: number
  private validate: (value: T) => string
  constructor(initial: T, save: (value: T) => Promise<T>, validate: (value: T) => string, delay = 700) {
    this.value = initial; this.version = initial.version
    this.save = save; this.validate = validate; this.delay = delay
  }
  subscribe(listener: (state: SaveState, result?: T) => void) {
    this.listeners.add(listener); listener(this.state)
    return () => { this.listeners.delete(listener) }
  }
  private publish(status: SaveState['status'], message = '', result?: T) {
    this.state = { status, message, dirty: this.revision !== this.savedRevision }
    this.listeners.forEach(listener => listener(this.state, result))
  }
  change(value: T) {
    if (this.disposed) return
    this.value = value; this.revision++; clearTimeout(this.timer)
    if (this.state.status === 'conflict') { this.publish('conflict', this.state.message); return }
    this.publish(this.running ? 'saving' : 'pending')
    if (!this.composing) this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }
  composition(active: boolean) {
    this.composing = active; clearTimeout(this.timer)
    if (!active && this.state.dirty && this.state.status === 'pending') this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }
  async flush() {
    clearTimeout(this.timer)
    if (this.disposed || this.composing || this.running || this.state.status === 'conflict' || this.revision === this.savedRevision) return
    const message = this.validate(this.value)
    if (message) { this.publish('failed', message); return }
    const revision = this.revision, snapshot = { ...this.value, version: this.version }
    this.running = true; this.publish('saving')
    try {
      const result = await this.save(snapshot)
      if (this.disposed) return
      this.version = result.version; this.savedRevision = revision
      this.publish(this.revision === revision ? 'saved' : 'pending', '', result)
    } catch (error) {
      if (this.disposed) return
      clearTimeout(this.timer)
      this.publish(error instanceof ApiError && [404, 409].includes(error.status) ? 'conflict' : 'failed', error instanceof Error ? error.message : '保存失败，请重试')
    } finally { this.running = false }
    if (!this.disposed && !this.composing && this.state.status === 'pending') this.timer = setTimeout(() => { void this.flush() }, 0)
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear() }
}
