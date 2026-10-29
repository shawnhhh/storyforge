import { randomUUID, createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { CreativeProvider, GenerationInput, GenerationOutput, StudioTask } from '../../../../shared/contracts/studio.js'
import type { CostControls } from './costs.js'
import { HttpError } from '../novels/store.js'

export interface ModelCapability { id: string; kinds: ('music' | 'video')[]; maxPrompt: number }
export type RemoteState = { status: 'running'; progress: number } | { status: 'completed'; output: GenerationOutput } | { status: 'failed'; code: string }
/** submit MUST be idempotent for key; lookup MUST reconcile ambiguous submissions before retry. */
export interface AsyncCreativeProvider {
  readonly id: string
  readonly models: readonly ModelCapability[]
  readonly capabilities?: {remoteQuery:boolean;remoteCancel:boolean;remoteIdempotency:boolean;webhook:boolean;localCancellation:boolean}
  stop?():void
  validate(input: GenerationInput, model: string): void
  lookup(key: string, signal: AbortSignal): Promise<string | null>
  submit(input: GenerationInput, model: string, key: string, signal: AbortSignal): Promise<string>
  poll(remoteId: string, input: GenerationInput, signal: AbortSignal): Promise<RemoteState>
  cancel(remoteId: string, signal: AbortSignal): Promise<void>
  verifyWebhook?(body: unknown, signature: string): { key: string } | null
}
/** Local fixture bridge only; never adapt a paid synchronous provider through this class. */
export class LocalAsyncProvider implements AsyncCreativeProvider {
  readonly id: string
  readonly models = ['mock-v1','mock-metered'].map(id=>({ id, kinds: ['music', 'video'] as ('music' | 'video')[], maxPrompt: 10000 }))
  constructor(private local: CreativeProvider) { this.id = local.id }
  validate(input: GenerationInput, model: string) {
    const capability = this.models.find(m => m.id === model)
    if (!capability || !capability.kinds.includes(input.project.kind) || input.prompt.length > capability.maxPrompt) throw new HttpError(400, '模型或参数不支持')
  }
  async lookup(key: string) { return key }
  async submit(_input: GenerationInput, _model: string, key: string) { return key }
  async poll(_id: string, input: GenerationInput): Promise<RemoteState> { return { status: 'completed', output: await this.local.generate(input) } }
  async cancel() { /* local deterministic fixtures have no external side effects */ }
}
class ProviderFailure extends Error {}
export class RetryableProviderError extends Error {}
interface Job { taskId: string; provider: string; model: string; key: string; digest: string; snapshot: string; remoteId: string | null; attempts: number; due: number; deadline: number; lease: string | null; leaseUntil: number; cancel: number }
const terminal = new Set(['completed', 'failed', 'cancelled'])
export class StudioJobs {
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  constructor(private db: DatabaseSync, readonly providers: readonly AsyncCreativeProvider[], private publish: (projectId: string, output: GenerationOutput, taskId:string) => string|null, private costs?:CostControls) {
    if (new Set(providers.map(p => p.id)).size !== providers.length) throw new Error('Duplicate provider IDs')
    this.wake()
  }
  private atomic<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result } catch (e) { this.db.exec('ROLLBACK'); throw e } }
  private event(id: string, status: string) { this.db.prepare('INSERT INTO studio_job_events(taskId,status,at) VALUES(?,?,?)').run(id, status, Date.now()) }
  history(id: string) { return this.db.prepare('SELECT status,at FROM studio_job_events WHERE taskId=? ORDER BY id').all(id) }
  submit(input: GenerationInput, body: Record<string, unknown>, onSubmit?: (taskId:string)=>void) {
    const provider = this.providers.find(p => p.id === (body.provider ?? 'mock')), model = String(body.model ?? 'mock-v1')
    if (!provider) throw new HttpError(400, '服务商未启用')
    provider.validate(input, model)
    if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !/^[\w-]{8,128}$/.test(body.idempotencyKey))) throw new HttpError(400, '幂等键无效')
    const key = String(body.idempotencyKey ?? randomUUID()), snapshot = JSON.stringify(input)
    const digest = createHash('sha256').update(JSON.stringify([provider.id, model, snapshot])).digest('hex')
    const id = this.atomic(() => {
      const old = this.db.prepare('SELECT taskId,digest FROM studio_jobs WHERE key=?').get(key)
      if (old) { if (old.digest !== digest) throw new HttpError(409, '幂等键已用于不同请求'); return String(old.taskId) }
      if (this.db.prepare("SELECT 1 FROM studio_tasks WHERE projectId=? AND status IN ('queued','running')").get(input.project.id)) throw new HttpError(409, '项目已有生成任务')
      const id = randomUUID(), now = Date.now()
      this.db.prepare('INSERT INTO studio_tasks VALUES(?,?,?,?,?,?,?,?,?)').run(id, input.project.id, provider.id, 'queued', 0, input.prompt, null, null, new Date(now).toISOString())
      this.costs?.reserve(id,input,provider.id,model,body.confirmation)
      this.db.prepare('INSERT INTO studio_jobs(taskId,provider,model,key,digest,snapshot,due,deadline) VALUES(?,?,?,?,?,?,?,?)').run(id, provider.id, model, key, digest, snapshot, now, now + 30 * 60 * 1000)
      onSubmit?.(id); this.event(id, 'submitted'); this.event(id, 'queued'); return id
    })
    this.wake(); return this.task(id)
  }
  task(id: string): StudioTask { const task = this.db.prepare('SELECT t.*,m.mediaId FROM studio_tasks t LEFT JOIN studio_task_media m ON m.taskId=t.id WHERE t.id=?').get(id); if (!task) throw new HttpError(404, '任务不存在'); return task as unknown as StudioTask }
  cancel(id: string) {
    this.atomic(() => {
      const task = this.task(id)
      if (terminal.has(task.status)) return
      this.db.prepare('UPDATE studio_jobs SET cancel=1,due=0 WHERE taskId=?').run(id)
      // Publish is fenced immediately; remote cancellation is durable and retried by worker.
      this.db.prepare("UPDATE studio_tasks SET status='cancelled',error=NULL WHERE id=?").run(id); this.event(id, 'cancelled')
    }); this.wake(); return this.task(id)
  }
  webhook(providerId: string, body: unknown, signature: string) {
    const verified = this.providers.find(p => p.id === providerId)?.verifyWebhook?.(body, signature)
    if (!verified) throw new HttpError(403, 'Webhook签名无效或未启用')
    // A signed event only wakes authoritative polling; never trust callback result bytes.
    this.db.prepare('UPDATE studio_jobs SET due=0 WHERE provider=? AND key=?').run(providerId, verified.key); this.wake()
  }
  stop() { this.providers.forEach(p=>p.stop?.()); this.stopped = true; clearTimeout(this.timer) }
  wake() { if (this.stopped || this.timer) return; this.timer = setTimeout(() => { this.timer = undefined; void this.tick() }, 100); this.timer.unref() }
  async tick() {
    if (this.stopped || !this.db.isOpen) return
    let job: Job | undefined
    try {
      job = this.atomic(() => {
        if (Number(this.db.prepare('SELECT COUNT(*) AS n FROM studio_jobs WHERE leaseUntil>?').get(Date.now())!.n) >= 2) return
        const row = this.db.prepare(`SELECT j.* FROM studio_jobs j JOIN studio_tasks t ON t.id=j.taskId WHERE (t.status IN ('queued','running') OR j.cancel=1) AND j.due<=? AND j.leaseUntil<=? ORDER BY j.due,j.taskId LIMIT 1`).get(Date.now(), Date.now()) as unknown as Job | undefined
        if (!row) return
        row.lease = randomUUID(); this.db.prepare('UPDATE studio_jobs SET lease=?,leaseUntil=? WHERE taskId=?').run(row.lease, Date.now() + 15000, row.taskId); return row
      })
      if (!job) return
      const claimed = job, provider = this.providers.find(p => p.id === claimed.provider)
      if (!provider) throw new Error('provider unavailable')
      const input = JSON.parse(claimed.snapshot) as GenerationInput
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const call = <T>(action: (signal: AbortSignal) => Promise<T>) => {
        if (controller.signal.aborted) return Promise.reject<T>(new RetryableProviderError('timeout'))
        return Promise.race([action(controller.signal), new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(new RetryableProviderError('timeout')), { once: true }))])
      }
      try {
        if (claimed.cancel) {
          const remote = claimed.remoteId ?? await call(s => provider.lookup(claimed.key, s))
          if (remote) await call(s => provider.cancel(remote, s))
          this.commit(claimed, () => { this.db.prepare('UPDATE studio_jobs SET cancel=0 WHERE taskId=?').run(claimed.taskId); this.event(claimed.taskId, provider.capabilities?.remoteCancel===false?'local-cancelled-remote-unsupported':'remote-cancelled') }); return
        }
        if (Date.now() >= claimed.deadline) throw new Error('deadline')
        if (!claimed.remoteId) {
          const remote = await call(s => provider.lookup(claimed.key, s)) ?? await call(s => provider.submit(input, claimed.model, claimed.key, s))
          this.commit(claimed, () => { this.db.prepare('UPDATE studio_jobs SET remoteId=?,due=? WHERE taskId=?').run(remote, Date.now() + 100, claimed.taskId); this.db.prepare("UPDATE studio_tasks SET status='running',progress=30 WHERE id=? AND status='queued'").run(claimed.taskId); this.event(claimed.taskId, 'running') })
        } else {
          const result = await call(s => provider.poll(claimed.remoteId!, input, s))
          this.commit(claimed, () => {
            if (this.task(claimed.taskId).status === 'cancelled') return
            if (Date.now() >= claimed.deadline) throw new Error('deadline')
            if (result.status === 'completed') {
              const assetId = this.publish(input.project.id, result.output,claimed.taskId)
              this.db.prepare("UPDATE studio_tasks SET status='completed',progress=100,assetId=? WHERE id=?").run(assetId, claimed.taskId); this.costs?.completed(claimed.taskId); this.event(claimed.taskId, 'completed')
            } else if (result.status === 'failed') throw new ProviderFailure('remote failed')
            else { this.db.prepare('UPDATE studio_tasks SET progress=? WHERE id=?').run(Math.max(0, Math.min(99, Math.floor(result.progress))), claimed.taskId); this.db.prepare('UPDATE studio_jobs SET due=?,attempts=0 WHERE taskId=?').run(Date.now() + 1000, claimed.taskId) }
          })
        }
      } finally { clearTimeout(timeout) }
    } catch (error) {
      if (job && this.db.isOpen) {
        try { this.commit(job, () => {
          const retry = error instanceof RetryableProviderError && job!.attempts < 4 && Date.now() < job!.deadline
          if (retry) { this.db.prepare('UPDATE studio_jobs SET attempts=attempts+1,due=? WHERE taskId=?').run(Date.now() + Math.min(30000, 500 * 2 ** job!.attempts) + Math.floor(Math.random() * 100), job!.taskId); this.event(job!.taskId, 'retry') }
          else { this.db.prepare("UPDATE studio_tasks SET status=CASE WHEN status='cancelled' THEN status ELSE 'failed' END,error=? WHERE id=?").run(error instanceof ProviderFailure?'生成或导入失败；未自动重发，请核对服务端后确认重试':'生成或取消失败，请检查任务历史',job!.taskId); this.db.prepare('UPDATE studio_jobs SET cancel=0 WHERE taskId=?').run(job!.taskId); this.event(job!.taskId, 'failed') }
        }) } catch { /* closed database or storage failure: durable lease permits recovery */ }
      }
    } finally { if (job && this.db.isOpen) { try { this.db.prepare('UPDATE studio_jobs SET lease=NULL,leaseUntil=0 WHERE taskId=? AND lease=?').run(job.taskId, job.lease) } catch { /* recover after lease expiry */ } } if (this.db.isOpen) this.wake() }
  }
  private commit(job: Job, action: () => void) { if (this.stopped || !this.db.isOpen) return; this.atomic(() => { if (this.db.prepare('SELECT 1 FROM studio_jobs WHERE taskId=? AND lease=? AND leaseUntil>?').get(job.taskId, job.lease, Date.now())) action() }) }
}
