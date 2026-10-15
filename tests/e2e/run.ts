import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No test port available')
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return address.port
}

const dir = mkdtempSync(join(tmpdir(), 'storyforge-e2e-'))
const children: { child: ChildProcess; exited: Promise<number | null> }[] = []
function launch(args: string[], env: NodeJS.ProcessEnv, inherit = false) {
  const child = spawn(process.execPath, args, { env, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout?.on('data', data => { log += data })
  child.stderr?.on('data', data => { log += data })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  children.push({ child, exited })
  return { child, exited, log: () => log }
}
async function ready(service: ReturnType<typeof launch>, url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (service.child.exitCode !== null) throw new Error(service.log())
    try { if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return } catch { /* wait for local startup */ }
    await delay(100)
  }
  throw new Error(`Test service failed to start: ${service.log()}`)
}
const stop = () => { for (const { child } of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM') }
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  const [apiPort, webPort] = await Promise.all([freePort(), freePort()])
  const baseURL = `http://127.0.0.1:${webPort}`
  // Explicit overrides: never use .env or the application's existing data directory.
  const env = { ...process.env, STORYFORGE_AI_API_KEY: '', SERVER_PORT: String(apiPort), STORYFORGE_DATA_DIR: dir, STORYFORGE_BACKUP_DIR: join(dir, 'backups'), E2E_BASE_URL: baseURL, E2E_OUTPUT_DIR: resolve('work/e2e-results') }
  const api = launch(['--import', 'tsx', 'server/src/index.ts'], env)
  await ready(api, `http://127.0.0.1:${apiPort}/api/health`)
  const web = launch(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], env)
  await ready(web, baseURL)
  const tests = launch(['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/e2e/playwright.config.ts', ...process.argv.slice(2)], env, true)
  process.exitCode = (await tests.exited) ?? 1
} finally {
  stop()
  await Promise.all(children.map(async ({ child, exited }) => {
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
    try { await exited } finally { clearTimeout(timer) }
  }))
  rmSync(dir, { recursive: true, force: true })
}
