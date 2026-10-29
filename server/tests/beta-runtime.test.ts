import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { initializeProfile, isolatedEnvironment, loadProfile, pathsOverlap, verifyProfile, worktreeInfo } from '../../scripts/beta.js'
import { openDatabase } from '../src/db/database.js'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { MediaStore } from '../src/modules/studio/media.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { MockCreativeProvider } from '../src/modules/studio/provider.js'
import { createHash } from 'node:crypto'

function fixture(full = false) {
  const root = mkdtempSync(join(tmpdir(), 'sf-beta-')), repo = join(root, 'repo'), worktree = join(root, '候选 code'), profile = join(root, 'profile')
  mkdirSync(repo)
  const git = (args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  git(['init', '-q']); git(['config', 'user.name', 'Synthetic test']); git(['config', 'user.email', 'mock@example.invalid'])
  writeFileSync(join(repo, '.gitignore'), 'node_modules\ndist\n.env\nwork\n')
  if (full) for (const name of ['server', 'shared', 'scripts', 'vite.config.ts', 'package.json']) cpSync(resolve(name), join(repo, name), { recursive: true })
  git(['add', '.']); git(['commit', '-qm', 'isolated synthetic fixture']); git(['worktree', 'add', '--detach', worktree, 'HEAD'])
  return { root, repo, worktree, profile, close() { rmSync(root, { recursive: true, force: true }) } }
}
test('Mac path protection covers case-folding and Unicode normalization without confusing sibling directories', () => {
  assert.equal(pathsOverlap('/Users/mock/StoryForge', '/users/MOCK/storyforge/data', true), true)
  assert.equal(pathsOverlap('/tmp/café', '/tmp/cafe\u0301/data', true), true)
  assert.equal(pathsOverlap('/tmp/StoryForge', '/tmp/StoryForge-Beta/profile', true), false)
})
test('beta initialization requires a linked detached worktree and a brand-new external profile', async () => {
  const f = fixture()
  try {
    await assert.rejects(initializeProfile(f.repo, f.profile), /linked worktree/)
    const p = await initializeProfile(f.worktree, f.profile)
    assert.notEqual(p.apiPort, p.webPort); assert.equal(p.sha, worktreeInfo(f.worktree).sha)
    assert.deepEqual(loadProfile(f.worktree, f.profile), p)
    await assert.rejects(initializeProfile(f.worktree, f.profile), /不存在的新目录/)
    execFileSync('git', ['-C', f.worktree, 'switch', '-c', 'fixture-branch'], { stdio: 'pipe' })
    assert.throws(() => loadProfile(f.worktree, f.profile), /detached HEAD/)
  } finally { f.close() }
})
test('beta guards refuse repository/ancestor paths, real default paths, existing data and relative paths', async () => {
  const f = fixture()
  try {
    const { homedir } = await import('node:os')
    for (const p of [join(f.repo, 'data'), join(f.worktree, 'backups'), f.root, join(homedir(), 'Library/Application Support/StoryForge'), join(f.root, 'bad\tpath'), 'relative-profile']) await assert.rejects(initializeProfile(f.worktree, p))
    const old = join(f.root, 'existing'); mkdirSync(old); writeFileSync(join(old, 'do-not-change'), 'synthetic witness')
    await assert.rejects(initializeProfile(f.worktree, old)); assert.equal(readFileSync(join(old, 'do-not-change'), 'utf8'), 'synthetic witness')
  } finally { f.close() }
})
test('beta guards reject a redirected data directory, root alias and hard-linked database without touching targets', async () => {
  const f = fixture()
  try {
    await initializeProfile(f.worktree, f.profile)
    const witness = join(f.root, 'outside'); mkdirSync(witness); writeFileSync(join(witness, 'witness'), 'unchanged')
    symlinkSync(witness, join(f.profile, 'data', 'redirect')); assert.throws(() => loadProfile(f.worktree, f.profile), /链接/)
    rmSync(join(f.profile, 'data', 'redirect'))
    symlinkSync(f.profile, join(f.root, 'alias')); assert.throws(() => loadProfile(f.worktree, join(f.root, 'alias')), /符号链接/)
    linkSync(join(witness, 'witness'), join(f.profile, 'data', 'storyforge.sqlite')); assert.throws(() => loadProfile(f.worktree, f.profile), /链接/)
    assert.equal(readFileSync(join(witness, 'witness'), 'utf8'), 'unchanged')
  } finally { f.close() }
})
test('beta profile is pinned to its exact worktree SHA and validated ports', async () => {
  const f = fixture()
  try {
    const p = await initializeProfile(f.worktree, f.profile)
    const path = join(f.profile, 'storyforge-beta.json')
    for (const patch of [{ sha: 'a'.repeat(40) }, { root: f.repo }, { webPort: p.apiPort }, { apiPort: 80 }]) {
      writeFileSync(path, JSON.stringify({ ...p, ...patch })); assert.throws(() => loadProfile(f.worktree, f.profile))
    }
  } finally { f.close() }
})
test('beta environment strips inherited providers, budgets, keys, Vite variables and Node preload without reading .env', async () => {
  const f = fixture()
  try {
    const p = await initializeProfile(f.worktree, f.profile), env = isolatedEnvironment(p, { PATH: '/synthetic/bin', HTTPS_PROXY: 'http://proxy.invalid', STORYFORGE_AI_API_KEY: 'synthetic', STORYFORGE_HAILUO_ENABLE: 'official', STORYFORGE_MEDIA_BUDGET_CONFIG: 'bad', VITE_FAKE_KEY: 'synthetic', NODE_OPTIONS: '--require /missing', SERVER_PORT: '80', STORYFORGE_DATA_DIR: '/never-open' })
    assert.equal(env.STORYFORGE_AI_API_KEY, ''); assert.equal(env.STORYFORGE_HAILUO_ENABLE, undefined); assert.equal(env.STORYFORGE_MEDIA_BUDGET_CONFIG, undefined); assert.equal(env.VITE_FAKE_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.STORYFORGE_DATA_DIR, join(p.root, 'data')); assert.equal(env.STORYFORGE_BACKUP_DIR, join(p.root, 'backups')); assert.equal(env.HTTPS_PROXY, 'http://proxy.invalid'); assert.equal(env.SERVER_PORT, String(p.apiPort))
  } finally { f.close() }
})
test('offline beta verification checks both WAL databases, foreign keys and every CAS object; refuses live service lock and corruption', async () => {
  const f = fixture()
  try {
    await initializeProfile(f.worktree, f.profile)
    const data = join(f.profile, 'data'), story = openDatabase(data), studio = openStudioDatabase(data), store = new StudioStore(studio), media = new MediaStore(studio)
    const p = store.create({ kind: 'music', title: 'synthetic' }), out = await new MockCreativeProvider().generate({ project: p, prompt: 'mock' }), bytes = Buffer.from(out.data), digest = createHash('sha256').update(bytes).digest('hex')
    const upload = media.start(p.id, { name: out.name, mime: out.mime, bytes: bytes.length, digest }); media.chunk(upload.id, { offset: 0, data: bytes.toString('base64') }); await media.complete(upload.id)
    store.jobs.stop(); story.close(); studio.close()
    assert.equal((await verifyProfile(f.worktree, f.profile)).length, 2)
    const lock = new DatabaseSync(join(data, '.storyforge-service-lock.sqlite')); lock.exec('BEGIN EXCLUSIVE')
    try { await assert.rejects(verifyProfile(f.worktree, f.profile), /locked/) } finally { lock.exec('ROLLBACK'); lock.close() }
    writeFileSync(media.objectPath(digest), Buffer.alloc(bytes.length)); await assert.rejects(verifyProfile(f.worktree, f.profile), /CAS哈希/)
  } finally { f.close() }
})
function http(port: number, path: string, method = 'GET', body?: unknown, generation?: string) {
  return new Promise<{ status: number; generation: string; text: string }>((ok, fail) => {
    const r = request({ host: '127.0.0.1', port, path, method, headers: { 'Content-Type': 'application/json', ...(generation ? { 'X-StoryForge-Generation': generation } : {}) } }, response => { let text = ''; response.on('data', b => { text += b }); response.on('end', () => ok({ status: response.statusCode!, generation: String(response.headers['x-storyforge-generation'] ?? ''), text })) })
    r.on('error', fail); r.setTimeout(2000, () => r.destroy(Error('test HTTP timeout'))); r.end(body === undefined ? undefined : JSON.stringify(body))
  })
}
test('beta production preview starts, persists a new work across graceful shutdown and restart, isolates .env and preserves backups', { timeout: 30000 }, async () => {
  const f = fixture(true)
  let child: ReturnType<typeof spawn> | undefined
  try {
    symlinkSync(resolve('node_modules'), join(f.worktree, 'node_modules'), 'dir'); symlinkSync(resolve('dist'), join(f.worktree, 'dist'), 'dir')
    writeFileSync(join(f.worktree, '.env'), 'STORYFORGE_DATA_DIR=/must-never-be-opened\nVITE_SYNTHETIC_SECRET=must-not-be-exposed\n')
    const p = await initializeProfile(f.worktree, f.profile)
    async function start() {
      child = spawn(process.execPath, ['scripts/beta.ts', 'start', '--profile', f.profile], { cwd: f.worktree, env: { ...process.env, STORYFORGE_HAILUO_ENABLE: 'official', STORYFORGE_DATA_DIR: '/must-never-be-opened', STORYFORGE_AI_API_KEY: 'synthetic-never-used' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let log = ''; child.stdout!.on('data', b => { log += b }); child.stderr!.on('data', b => { log += b })
      for (let i = 0; i < 150; i++) { if (log.includes('BETA_READY')) return; if (child.exitCode !== null) throw Error(log); await new Promise(r => setTimeout(r, 50)) }
      throw Error(log || 'beta startup timeout')
    }
    async function stop() { const c = child!; const exited = new Promise<number | null>(r => c.once('exit', r)); c.kill('SIGTERM'); assert.equal(await exited, 0); child = undefined }
    await start()
    const page = await http(p.webPort, '/'); assert.equal(page.status, 200)
    const assets = [...page.text.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]); assert.ok(assets.length >= 2)
    for (const asset of assets) { const r = await http(p.webPort, asset); assert.equal(r.status, 200); assert.ok(r.text.length > 50); assert.equal(r.text.trimStart().toLowerCase().startsWith('<!doctype'), false) }
    const health = await http(p.webPort, '/api/health'), made = await http(p.webPort, '/api/novels', 'POST', { title: '合成首启作品', description: 'temporary' }, health.generation)
    assert.equal(made.status, 201, made.text)
    const providers = JSON.parse((await http(p.webPort, '/api/studio/providers')).text) as { id: string }[]; assert.deepEqual(providers.map(p => p.id), ['mock'])
    const before = (await http(p.webPort, '/api/novels')).text
    await stop(); assert.equal((await verifyProfile(f.worktree, f.profile)).length, 2); assert.ok(existsSync(join(f.profile, 'backups')))
    await start(); assert.equal((await http(p.webPort, '/api/novels')).text, before); await stop()
    assert.equal((await verifyProfile(f.worktree, f.profile)).length, 2); assert.equal(existsSync(join(f.worktree, 'data')), false)
  } finally { if (child && child.exitCode === null) { const exited = new Promise(r => child!.once('exit', r)); child.kill('SIGTERM'); await exited }; f.close() }
})
