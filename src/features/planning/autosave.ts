import type { PlanningSnapshot } from '../../../shared/contracts/planning.js'
export type PlanningSaveStatus = 'saved' | 'pending' | 'saving' | 'failed' | 'conflict'
// One request at a time; drafts are persisted before scheduling a network write.
export class PlanningAutosave {
  private value: PlanningSnapshot
  private revision = 0
  private timer?: ReturnType<typeof setTimeout>
  private inFlight = false
  private disposed = false
  private composing = false
  private stopped = false
  private callbacks: {
    save: (value: PlanningSnapshot) => Promise<PlanningSnapshot>
    draft: (value: PlanningSnapshot | null) => void
    status: (status: PlanningSaveStatus, error?: string) => void
    version: (version: number) => void
  }
  constructor(initial: PlanningSnapshot, callbacks: PlanningAutosave['callbacks'], paused = false) { this.value = initial; this.callbacks = callbacks; this.stopped = paused }
  change(value: PlanningSnapshot) {
    if (this.disposed) return
    this.value = { ...value, version: this.value.version }; this.revision++
    this.callbacks.draft(this.value)
    if (this.timer) clearTimeout(this.timer)
    if (this.stopped) return
    this.callbacks.status('pending')
    if (!this.composing) this.schedule()
  }
  composition(active: boolean) {
    this.composing = active
    if (this.timer) clearTimeout(this.timer)
    if (!active && this.revision && !this.stopped) this.schedule()
  }
  private schedule() { if (this.timer) clearTimeout(this.timer); this.timer = setTimeout(() => { void this.flush() }, 700) }
  async flush() {
    if (this.disposed || this.inFlight || this.composing || this.stopped || !this.revision) return
    if (this.timer) clearTimeout(this.timer)
    const revision = this.revision, value = this.value
    this.inFlight = true; this.callbacks.status('saving')
    try {
      const saved = await this.callbacks.save(value)
      this.value = { ...this.value, version: saved.version }
      if (revision === this.revision) { this.revision = 0; this.callbacks.draft(null) }
      else this.callbacks.draft(this.value)
      if (!this.disposed) {
        this.callbacks.version(saved.version)
        this.callbacks.status(this.revision ? 'pending' : 'saved')
      }
    } catch (reason) {
      if (this.timer) clearTimeout(this.timer)
      const conflict = typeof reason === 'object' && reason && 'status' in reason && [404, 409].includes(Number(reason.status))
      this.stopped = Boolean(conflict)
      if (!this.disposed) this.callbacks.status(conflict ? 'conflict' : 'failed', reason instanceof Error ? reason.message : '保存失败，请重试')
      // A failed request never discards or automatically retries a draft.
      return
    } finally { this.inFlight = false }
    if (!this.disposed && this.revision && !this.composing) this.schedule()
  }
  dispose() { this.disposed = true; if (this.timer) clearTimeout(this.timer) }
}
