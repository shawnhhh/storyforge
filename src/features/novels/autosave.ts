import type { Chapter, ChapterResult, RichTextDocument } from '../../../shared/contracts/novels.js'
import { ApiError } from './api.js'
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'
export interface SaveState { status: SaveStatus; dirty: boolean; message: string }
type Content = RichTextDocument | (() => RichTextDocument)
type Save = (id: string, version: number, title: string, content: RichTextDocument) => Promise<ChapterResult>

// A single in-flight write per editor; subsequent edits are queued with the returned version.
export class ChapterSaver {
  private version: number
  private revision = 0
  private savedRevision = 0
  private title: string
  private content: Content
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private inFlight: Promise<void> | undefined
  private disposed = false
  private listeners = new Set<(state: SaveState, result?: ChapterResult) => void>()
  state: SaveState = { status: 'saved', dirty: false, message: '' }
  private chapter: Chapter
  private save: Save
  private delay: number
  constructor(chapter: Chapter, save: Save, delay = 700) {
    this.chapter = chapter
    this.save = save
    this.delay = delay
    this.version = chapter.version
    this.title = chapter.title
    this.content = chapter.content
  }
  subscribe(listener: (state: SaveState, result?: ChapterResult) => void) {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }
  private publish(status: SaveStatus, message = '', result?: ChapterResult) {
    const dirty = this.revision !== this.savedRevision
    if (!result && this.state.status === status && this.state.dirty === dirty && this.state.message === message) return
    this.state = { status, dirty, message }
    this.listeners.forEach(listener => listener(this.state, result))
  }
  change(title: string, content: Content) {
    if (this.disposed) return
    this.title = title
    this.content = content
    this.revision++
    clearTimeout(this.timer)
    if (this.state.status === 'conflict') { this.publish('conflict', this.state.message); return }
    this.publish(this.running ? 'saving' : 'pending')
    this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }
  // Navigation waits for every queued revision, including an already running write.
  // A failed/conflicting draft stays mounted until the writer explicitly recovers it.
  async saveBeforeLeave(): Promise<boolean> {
    clearTimeout(this.timer)
    if (this.state.status === 'failed' || this.state.status === 'conflict') return false
    do { await (this.inFlight ?? this.flush()) }
    while (!this.disposed && this.state.status === 'pending')
    return !this.disposed && !this.state.dirty
  }
  flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.disposed || this.running || this.state.status === 'conflict' || this.revision === this.savedRevision) return Promise.resolve()
    if (!this.title.trim()) { this.publish('failed', '章节标题不能为空'); return Promise.resolve() }
    this.running = true
    this.inFlight = this.write().finally(() => { this.inFlight = undefined })
    return this.inFlight
  }
  private async write(): Promise<void> {
    const revision = this.revision
    this.publish('saving')
    try {
      const result = await this.save(this.chapter.id, this.version, this.title, typeof this.content === 'function' ? this.content() : this.content)
      if (this.disposed) return
      this.version = result.chapter.version
      this.savedRevision = revision
      this.publish(this.revision === revision ? 'saved' : 'pending', '', result)
    } catch (error) {
      if (this.disposed) return
      // Edits made during a failed request must not leave a timed retry behind.
      clearTimeout(this.timer)
      this.publish(error instanceof ApiError && [404, 409].includes(error.status) ? 'conflict' : 'failed', error instanceof Error ? error.message : '保存失败')
    } finally { this.running = false }
    if (!this.disposed && this.state.status === 'pending') {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { void this.flush() }, 0)
    }
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear() }
}
