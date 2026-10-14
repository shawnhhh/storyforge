import type { Chapter, ChapterResult, RichTextDocument } from '../../../shared/contracts/novels.js'
import { ApiError } from './api.js'
export type SaveStatus = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'
export interface SaveState { status: SaveStatus; dirty: boolean; message: string }
type Save = (id: string, version: number, title: string, content: RichTextDocument) => Promise<ChapterResult>

// A single in-flight write per editor; subsequent edits are queued with the returned version.
export class ChapterSaver {
  private version: number
  private revision = 0
  private savedRevision = 0
  private title: string
  private content: RichTextDocument
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
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
    this.state = { status, dirty: this.revision !== this.savedRevision, message }
    this.listeners.forEach(listener => listener(this.state, result))
  }
  change(title: string, content: RichTextDocument) {
    this.title = title
    this.content = content
    this.revision++
    clearTimeout(this.timer)
    if (this.state.status === 'conflict') { this.publish('conflict', this.state.message); return }
    this.publish(this.running ? 'saving' : 'pending')
    this.timer = setTimeout(() => { void this.flush() }, this.delay)
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer)
    if (this.disposed || this.running || this.state.status === 'conflict' || this.revision === this.savedRevision) return
    if (!this.title.trim()) { this.publish('failed', '章节标题不能为空'); return }
    this.running = true
    const revision = this.revision
    this.publish('saving')
    try {
      const result = await this.save(this.chapter.id, this.version, this.title, this.content)
      this.version = result.chapter.version
      this.savedRevision = revision
      this.publish(this.revision === revision ? 'saved' : 'pending', '', result)
    } catch (error) {
      this.publish(error instanceof ApiError && error.status === 409 ? 'conflict' : 'failed', error instanceof Error ? error.message : '保存失败')
    } finally { this.running = false }
    if (!this.disposed && this.state.status === 'pending') this.timer = setTimeout(() => { void this.flush() }, 0)
  }
  dispose() { this.disposed = true; clearTimeout(this.timer); this.listeners.clear() }
}
