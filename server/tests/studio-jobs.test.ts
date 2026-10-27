import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { RetryableProviderError, type AsyncCreativeProvider } from '../src/modules/studio/jobs.js'
import { MockCreativeProvider } from '../src/modules/studio/provider.js'

function fixture(provider?: AsyncCreativeProvider) {
  const dir = mkdtempSync(join(tmpdir(), 'sf-jobs-')), db = openStudioDatabase(dir)
  const store = new StudioStore(db, undefined, provider ? [provider] : undefined)
  const p = store.create({ kind: 'music', title: 'isolated' })
  return { dir, db, store, p, close() { store.jobs.stop(); if (db.isOpen) db.close(); rmSync(dir, { recursive: true, force: true }) } }
}
async function tick(f: ReturnType<typeof fixture>) { f.db.prepare('UPDATE studio_jobs SET due=0').run(); await f.store.jobs.tick() }
test('idempotent durable submission retains immutable snapshot, rejects reuse and validates capability', async () => {
  const f = fixture(); f.store.jobs.stop()
  try {
    const body = { version: 1, prompt: 'song', idempotencyKey: 'request-123' }
    const a = await f.store.generate(f.p.id, body), b = await f.store.generate(f.p.id, body)
    assert.equal(a.id, b.id); assert.equal(f.store.tasks(f.p.id).length, 1)
    await assert.rejects(f.store.generate(f.p.id, { ...body, prompt: 'different' }), /幂等键/)
    await assert.rejects(f.store.generate(f.p.id, { ...body, model: 'unsupported' }), /不支持/)
    f.store.save(f.p.id, { ...f.p, content: 'new lyrics', settings: {} })
    const input = JSON.parse(String(f.db.prepare('SELECT snapshot FROM studio_jobs').get()!.snapshot))
    assert.equal(input.project.content, ''); assert.equal(input.project.version, 1)
    assert.deepEqual(f.store.jobs.history(a.id).map(e => e.status), ['submitted', 'queued'])
  } finally { f.close() }
})
test('queued work survives reopening and completion is atomic without changing newer edits', async () => {
  const f = fixture(); f.store.jobs.stop()
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song' })
    f.db.close()
    const db = openStudioDatabase(f.dir), store = new StudioStore(db)
    try {
      assert.equal(store.tasks(f.p.id)[0].status, 'queued')
      store.save(f.p.id, { ...f.p, content: 'keep this', settings: {} })
      await store.jobs.tick(); db.prepare('UPDATE studio_jobs SET due=0').run(); await store.jobs.tick()
      assert.equal(store.jobs.task(task.id).status, 'completed'); assert.equal(store.assets(f.p.id).length, 1)
      assert.equal(store.project(f.p.id).content, 'keep this')
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    } finally { store.jobs.stop(); db.close() }
  } finally { f.close() }
})
test('ambiguous remote submission reconciles by key after restart without a second charge', async () => {
  const remote = new Map<string, string>(); let submits = 0
  const provider: AsyncCreativeProvider = {
    id: 'mock', models: [{ id: 'mock-v1', kinds: ['music'], maxPrompt: 10000 }], validate() {},
    async lookup(key) { return remote.get(key) ?? null },
    async submit(_input, _model, key) { submits++; remote.set(key, 'remote-1'); throw new RetryableProviderError('secret must not escape') },
    async poll(_id, input) { return { status: 'completed', output: await new MockCreativeProvider().generate(input) } }, async cancel() {},
  }
  const f = fixture(provider)
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song' })
    await tick(f); assert.equal(submits, 1)
    assert.equal(f.db.prepare('SELECT attempts FROM studio_jobs').get()!.attempts, 1)
    assert.ok(Number(f.db.prepare('SELECT due FROM studio_jobs').get()!.due) > Date.now())
    f.store.jobs.stop(); f.db.close()
    const db = openStudioDatabase(f.dir), store = new StudioStore(db, undefined, [provider])
    try {
      db.prepare('UPDATE studio_jobs SET due=0').run(); await store.jobs.tick()
      db.prepare('UPDATE studio_jobs SET due=0').run(); await store.jobs.tick()
      assert.equal(submits, 1); assert.equal(store.jobs.task(task.id).status, 'completed')
      assert.ok(!JSON.stringify(store.jobs.history(task.id)).includes('secret'))
    } finally { store.jobs.stop(); db.close() }
  } finally { f.close() }
})
test('cancel during polling fences late completion and persists remote cancellation', async () => {
  let release!: () => void, polled!: () => void, cancels = 0
  const began = new Promise<void>(resolve => { polled = resolve })
  const provider: AsyncCreativeProvider = { id: 'mock', models: [], validate() {}, async lookup() { return 'remote' }, async submit() { return 'remote' }, async poll(_id, input) { polled(); await new Promise<void>(resolve => { release = resolve }); return { status: 'completed', output: await new MockCreativeProvider().generate(input) } }, async cancel() { cancels++ } }
  const f = fixture(provider)
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song' })
    await tick(f)
    const pending = tick(f); await began
    f.store.jobs.cancel(task.id); release(); await pending
    assert.equal(f.store.jobs.task(task.id).status, 'cancelled'); assert.equal(f.store.assets(f.p.id).length, 0)
    await tick(f); assert.equal(cancels, 1)
    assert.equal(f.db.prepare('SELECT cancel FROM studio_jobs').get()!.cancel, 0)
  } finally { f.close() }
})
test('two workers respect leases; expired lease recovers; deadline fails without submitting', async () => {
  const f = fixture()
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song' })
    f.db.prepare("UPDATE studio_jobs SET lease='other',leaseUntil=?").run(Date.now() + 60000)
    await tick(f); assert.equal(f.store.jobs.task(task.id).status, 'queued')
    f.db.prepare('UPDATE studio_jobs SET leaseUntil=0,deadline=0').run()
    await tick(f); assert.equal(f.store.jobs.task(task.id).status, 'failed'); assert.equal(f.store.assets(f.p.id).length, 0)
    assert.throws(() => f.store.jobs.webhook('mock', {}, 'fake'), /Webhook/)
  } finally { f.close() }
})
test('provider request timeout aborts, schedules bounded backoff, and never exposes secrets', async () => {
  let aborted = false
  const provider: AsyncCreativeProvider = { id: 'mock', models: [], validate() {}, async lookup() { return null }, async submit(_input, _model, _key, signal) { return new Promise((_resolve, reject) => signal.addEventListener('abort', () => { aborted = true; reject(new RetryableProviderError('api_key=DO_NOT_EXPOSE')) })) }, async poll() { throw new Error('unexpected') }, async cancel() {} }
  const f = fixture(provider)
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song' })
    await tick(f); assert.equal(aborted, true); assert.equal(f.store.jobs.task(task.id).status, 'queued')
    assert.equal(f.db.prepare('SELECT attempts FROM studio_jobs').get()!.attempts, 1)
    assert.ok(!JSON.stringify(f.store.export(f.p.id)).includes('DO_NOT_EXPOSE'))
    f.store.jobs.cancel(task.id); await tick(f)
    assert.equal(f.store.jobs.task(task.id).status, 'cancelled')
  } finally { f.close() }
})
test('signed webhook wakes authoritative polling and ignores forged result bytes', async () => {
  const provider: AsyncCreativeProvider = { id: 'mock', models: [], validate() {}, async lookup() { return 'remote' }, async submit() { return 'remote' }, async poll() { return { status: 'running', progress: 70 } }, async cancel() {}, verifyWebhook(_body, signature) { return signature === 'fixture-signature' ? { key: 'webhook-123' } : null } }
  const f = fixture(provider)
  try {
    const task = await f.store.generate(f.p.id, { version: 1, prompt: 'song', idempotencyKey: 'webhook-123' })
    await tick(f); await tick(f)
    assert.throws(() => f.store.jobs.webhook('mock', {}, 'bad'), /签名/)
    f.store.jobs.webhook('mock', { result: 'forged', status: 'completed' }, 'fixture-signature')
    assert.equal(f.db.prepare('SELECT due FROM studio_jobs').get()!.due, 0)
    await f.store.jobs.tick(); assert.equal(f.store.jobs.task(task.id).status, 'running'); assert.equal(f.store.assets(f.p.id).length, 0)
    f.store.jobs.cancel(task.id); await tick(f)
  } finally { f.close() }
})
