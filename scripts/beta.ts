/** Isolated, foreground-only beta launcher. Node 24; no .env, real keys or data deletion. */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { get } from 'node:http'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'

export interface BetaProfile { version: 1; id: string; root: string; worktree: string; sha: string; apiPort: number; webPort: number }
const marker = 'storyforge-beta.json'
const sourceRoot = realpathSync(fileURLToPath(new URL('../', import.meta.url)))
const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const within = (parent: string, child: string) => { const r = relative(parent, child); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)) }
export function pathsOverlap(a: string, b: string, insensitive = process.platform === 'darwin') {
  // Conservatively handle default macOS case-insensitive / Unicode-normalizing volumes.
  if (insensitive) { a = a.normalize('NFC').toLowerCase(); b = b.normalize('NFC').toLowerCase() }
  return within(a, b) || within(b, a)
}
function canonical(path: string): string {
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f]/.test(path)) throw Error('必须使用无控制字符的绝对路径')
  const p = resolve(path)
  return existsSync(p) ? realpathSync(p) : join(canonical(dirname(p)), p.slice(dirname(p).length + 1))
}
function port(value: number) { if (!Number.isInteger(value) || value < 1024 || value > 65535) throw Error('端口必须为1024–65535整数'); return value }
export function worktreeInfo(root: string, detached = true) {
  root = realpathSync(root)
  if (realpathSync(git(root, ['rev-parse', '--show-toplevel'])) !== root) throw Error('必须从独立worktree根目录运行')
  const common = realpathSync(git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']))
  const local = realpathSync(git(root, ['rev-parse', '--absolute-git-dir']))
  if (detached) {
    if (common === local) throw Error('测试启动必须使用独立linked worktree')
    let branch = ''
    try { branch = git(root, ['symbolic-ref', '--short', '-q', 'HEAD']) } catch { /* Detached HEAD is required. */ }
    if (branch) throw Error('测试worktree必须为detached HEAD，禁止修改来源分支')
  }
  const roots = git(root, ['worktree', 'list', '--porcelain', '-z']).split('\0').filter(s => s.startsWith('worktree ')).map(s => canonical(s.slice(9)))
  return { root, roots, sha: git(root, ['rev-parse', 'HEAD']) }
}
function safeRoot(root: string, worktree: string) {
  const target = canonical(root), info = worktreeInfo(worktree)
  const protectedRoots = [...info.roots, canonical(join(homedir(), 'Library/Application Support/StoryForge'))]
  if (protectedRoots.some(p => pathsOverlap(p, target))) throw Error('测试目录不能与任何源码worktree或正式StoryForge数据/备份路径重叠')
  return target
}
/** No link, hard-link, socket or special file may redirect a beta write. */
export function inspectTree(path: string) {
  const queue = [path]
  let count = 0
  while (queue.length) {
    const p = queue.pop()!, s = lstatSync(p)
    if (++count > 100000) throw Error('测试目录超过审计上限，请拆分测试档案')
    if (s.isSymbolicLink() || (!s.isDirectory() && (!s.isFile() || s.nlink !== 1))) throw Error('测试目录包含链接或非普通文件，拒绝启动')
    if (s.isDirectory()) queue.push(...readdirSync(p).map(n => join(p, n)))
  }
}
async function available(p = 0) {
  const server = createServer()
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(p, '127.0.0.1', ok) })
  const address = server.address()
  if (!address || typeof address === 'string') throw Error('无法分配隔离端口')
  await new Promise<void>((ok, fail) => server.close(e => e ? fail(e) : ok()))
  return address.port
}
export async function initializeProfile(worktree: string, path: string, apiPort?: number, webPort?: number) {
  const info = worktreeInfo(worktree), root = safeRoot(path, worktree)
  if (existsSync(root)) throw Error('init只接受不存在的新目录；不会接管、覆盖或删除已有数据')
  const api = apiPort === undefined ? await available() : port(apiPort)
  const web = webPort === undefined ? await available() : port(webPort)
  if (api === web) throw Error('API和Web端口不能相同')
  const profile: BetaProfile = { version: 1, id: randomUUID(), root, worktree: info.root, sha: info.sha, apiPort: api, webPort: web }
  mkdirSync(dirname(root), { recursive: true, mode: 0o700 }); mkdirSync(root, { mode: 0o700 })
  for (const d of ['data', 'backups', 'logs']) mkdirSync(join(root, d), { mode: 0o700 })
  writeFileSync(join(root, marker), JSON.stringify(profile, null, 2) + '\n', { mode: 0o600, flag: 'wx' })
  return profile
}
export function loadProfile(worktree: string, path: string): BetaProfile {
  if (lstatSync(path).isSymbolicLink()) throw Error('测试根目录不能是符号链接')
  const root = safeRoot(path, worktree)
  inspectTree(root)
  const p = JSON.parse(readFileSync(join(root, marker), 'utf8')) as BetaProfile, info = worktreeInfo(worktree)
  if (p.version !== 1 || !/^[a-f0-9-]{36}$/.test(p.id) || p.root !== root || p.worktree !== info.root || p.sha !== info.sha) throw Error('测试标记、worktree或SHA不匹配；请为新候选创建新profile')
  if (port(p.apiPort) === port(p.webPort)) throw Error('API和Web端口不能相同')
  for (const d of ['data', 'backups', 'logs']) if (!lstatSync(join(root, d)).isDirectory()) throw Error('测试目录结构无效')
  return p
}
export function isolatedEnvironment(profile: BetaProfile, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) => !/^(STORYFORGE_|VITE_|E2E_|SERVER_PORT$|NODE_OPTIONS$|NODE_PATH$)/.test(key)))
  return { ...clean, STORYFORGE_BETA: '1', STORYFORGE_DATA_DIR: join(profile.root, 'data'), STORYFORGE_BACKUP_DIR: join(profile.root, 'backups'), SERVER_PORT: String(profile.apiPort), STORYFORGE_AI_API_KEY: '' }
}
async function ready(child: ChildProcess, url: string) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode !== null) throw Error('测试服务提前退出，请查看终端日志')
    const ok = await new Promise<boolean>(done => {
      const r = get(url, response => { response.resume(); done(response.statusCode === 200) })
      r.setTimeout(800, () => { done(false); r.destroy() }); r.once('error', () => done(false))
    })
    if (ok) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw Error('测试服务启动超时')
}
export async function startProfile(worktree: string, path: string) {
  const p = loadProfile(worktree, path)
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('候选要求原生Node 24.x')
  for (const f of ['node_modules/tsx/dist/loader.mjs', 'node_modules/vite/bin/vite.js', 'dist/index.html']) if (!existsSync(join(worktree, f))) throw Error('请先在此worktree运行npm ci和npm run build')
  if (git(worktree, ['status', '--porcelain', '--untracked-files=no'])) throw Error('候选有已跟踪文件改动；请使用干净的精确SHA worktree')
  await available(p.apiPort); await available(p.webPort)
  const env = isolatedEnvironment(p), children: { child: ChildProcess; exited: Promise<number | null> }[] = []
  let stop!: () => void
  const stopped = new Promise<void>(r => { stop = r })
  let stopping = false
  const requestStop = () => { if (!stopping) { stopping = true; stop() }; for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }
  const launch = (args: string[]) => {
    const child = spawn(process.execPath, args, { cwd: worktree, env, stdio: ['ignore', 'inherit', 'inherit'] })
    const exited = new Promise<number | null>(r => { child.once('error', () => { process.exitCode = 1; requestStop(); r(1) }); child.once('exit', code => { if (!stopping) { process.exitCode = 1; requestStop() }; r(code) }) })
    children.push({ child, exited }); return child
  }
  process.on('SIGINT', requestStop); process.on('SIGTERM', requestStop)
  try {
    console.info(`BETA ${p.sha} | ${process.platform}/${process.arch} | ${p.root} | Mock only`)
    const api = launch(['--import', 'tsx', 'server/src/index.ts'])
    await ready(api, `http://127.0.0.1:${p.apiPort}/api/health`)
    if (stopping) return
    const web = launch(['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(p.webPort), '--strictPort'])
    await ready(web, `http://127.0.0.1:${p.webPort}`)
    console.info(`BETA_READY http://127.0.0.1:${p.webPort} | Ctrl+C关闭；保留全部测试数据和备份`)
    await stopped
  } finally {
    requestStop()
    await Promise.all(children.map(async ({ child, exited }) => {
      const timer = setTimeout(() => { console.error('关闭超时，强制结束自有子进程；请运行verify并保留数据'); process.exitCode = 1; child.kill('SIGKILL') }, 10000)
      try { await exited } finally { clearTimeout(timer) }
    }))
    process.off('SIGINT', requestStop); process.off('SIGTERM', requestStop)
    console.info('BETA_STOPPED：未删除数据库、媒体或备份')
  }
}
export async function verifyProfile(worktree: string, path: string) {
  const p = loadProfile(worktree, path), lock = new DatabaseSync(join(p.root, 'data', '.storyforge-service-lock.sqlite'))
  const result: { file: string; schema: number; mode: string }[] = []
  try {
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
    for (const file of ['storyforge.sqlite', 'studio.sqlite']) {
      const db = new DatabaseSync(join(p.root, 'data', file), { readOnly: true })
      try {
        db.exec('PRAGMA foreign_keys=ON')
        if (db.prepare('PRAGMA integrity_check').get()!.integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error(`${file}完整性或外键校验失败`)
        const mode = String(db.prepare('PRAGMA journal_mode').get()!.journal_mode)
        if (mode !== 'wal') throw Error(`${file}未处于WAL模式`)
        result.push({ file, schema: Number(db.prepare('PRAGMA user_version').get()!.user_version), mode })
        if (file === 'studio.sqlite') for (const r of db.prepare('SELECT digest,bytes FROM studio_media_objects').all()) {
          if (!/^[a-f0-9]{64}$/.test(String(r.digest))) throw Error('CAS哈希标识无效')
          const object = join(p.root, 'data/media/objects', String(r.digest)), h = createHash('sha256')
          if (lstatSync(object).size !== Number(r.bytes)) throw Error('CAS长度校验失败')
          for await (const chunk of createReadStream(object)) h.update(chunk)
          if (h.digest('hex') !== r.digest) throw Error('CAS哈希校验失败')
        }
      } finally { db.close() }
    }
  } finally { if (lock.isTransaction) lock.exec('ROLLBACK'); lock.close() }
  return result
}
async function main() {
  const [command, ...args] = process.argv.slice(2), values: Record<string, string> = {}
  for (let i = 0; i < args.length; i += 2) { if (!/^--(profile|path|ref|api-port|web-port)$/.test(args[i]) || !args[i + 1] || values[args[i]]) throw Error('参数无效或重复'); values[args[i]] = args[i + 1] }
  if (command === 'worktree') {
    if (!values['--path'] || !/^[a-f0-9]{40}$/.test(values['--ref'] ?? '')) throw Error('worktree --path 新绝对路径 --ref 精确40位SHA')
    const path = canonical(values['--path']), info = worktreeInfo(sourceRoot, false)
    if (existsSync(path) || info.roots.some(r => pathsOverlap(r, path))) throw Error('worktree目标必须是与源码分离的全新目录')
    git(sourceRoot, ['cat-file', '-e', `${values['--ref']}^{commit}`])
    execFileSync('git', ['-C', sourceRoot, 'worktree', 'add', '--detach', path, values['--ref']], { stdio: 'inherit' })
    return
  }
  const path = values['--profile']
  if (!path) throw Error('用法：node scripts/beta.ts init|check|start|verify --profile 全新绝对路径')
  if (command === 'init') console.info(await initializeProfile(sourceRoot, path, values['--api-port'] === undefined ? undefined : Number(values['--api-port']), values['--web-port'] === undefined ? undefined : Number(values['--web-port'])))
  else if (command === 'check') console.info(loadProfile(sourceRoot, path))
  else if (command === 'start') await startProfile(sourceRoot, path)
  else if (command === 'verify') console.info(await verifyProfile(sourceRoot, path))
  else throw Error('未知命令')
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e instanceof Error ? e.message : '测试启动失败'); process.exitCode = 1 })
