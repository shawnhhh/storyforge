import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { get } from 'node:http'
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

const musicMock = process.argv.includes('--mock-music3')
const planningMock = process.argv.includes('--mock-planning')
const testArgs = process.argv.slice(2).filter(value => value !== '--mock-planning' && value !== '--mock-music3')
const dir = mkdtempSync(join(tmpdir(), 'storyforge-e2e-'))
// A distinct output directory preserves earlier steps' traces when a later suite runs.
const outputDir = resolve('work/e2e-results', `${Date.now()}-${process.pid}`)
mkdirSync(outputDir, { recursive: true })
const started = performance.now()
const phase = (name: string) => console.log(`[e2e] ${name} elapsed=${Math.round(performance.now() - started)}ms`)
const children: { child: ChildProcess; exited: Promise<number | null>; log: () => string }[] = []
function launch(args: string[], env: NodeJS.ProcessEnv, inherit = false) {
  const child = spawn(process.execPath, args, { env, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'] })
  let log = ''
  child.stdout?.on('data', data => { log += data })
  child.stderr?.on('data', data => { log += data })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('exit', resolve)
    child.once('error', reject)
  })
  const service = { child, exited, log: () => log }
  children.push(service)
  return service
}
async function ready(service: ReturnType<typeof launch>, url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (service.child.exitCode !== null) throw new Error(service.log())
    // Use the local HTTP transport directly. Node 24.21's Undici can throw an
    // asynchronous setTypeOfService EINVAL on macOS before a fetch is settled.
    const available = await new Promise<boolean>(resolve => {
      const request = get(url, response => { response.resume(); resolve(response.statusCode === 200) })
      request.setTimeout(1000, () => { resolve(false); request.destroy() })
      request.once('error', () => resolve(false))
    })
    if (available) return
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
  const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !['STORYFORGE_AI_', 'STORYFORGE_OPENAI_', 'STORYFORGE_DEEPSEEK_', 'STORYFORGE_LOCAL_', 'STORYFORGE_MEDIA_', 'STORYFORGE_MUSIC3_'].some(prefix => key.startsWith(prefix))))
  const env = { ...isolatedEnv, E2E_PLANNING_MOCK: planningMock ? '1' : '', E2E_MUSIC3_MOCK: musicMock?'1':'', STORYFORGE_AI_API_KEY: '', SERVER_PORT: String(apiPort), STORYFORGE_DATA_DIR: dir, STORYFORGE_BACKUP_DIR: join(dir, 'backups'), E2E_BASE_URL: baseURL, E2E_OUTPUT_DIR: outputDir, PLAYWRIGHT_JSON_OUTPUT_FILE: join(outputDir, 'results.json') }
  phase('starting API')
  const api = launch(['--import', 'tsx', planningMock ? 'tests/e2e/ai-planning-server.ts' : musicMock?'tests/e2e/music3-server.ts':'server/src/index.ts'], env)
  await ready(api, `http://127.0.0.1:${apiPort}/api/health`)
  phase('API ready; starting Vite')
  const web = launch(['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'], env)
  await ready(web, baseURL)
  phase('Vite ready; starting Playwright')
  const tests = launch(['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/e2e/playwright.config.ts', ...testArgs], env, true)
  process.exitCode = (await tests.exited) ?? 1
  phase(`Playwright exited code=${process.exitCode}`)
} finally {
  phase('stopping child processes')
  stop()
  await Promise.all(children.map(async ({ child, exited }) => {
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 5000)
    try { await exited } finally { clearTimeout(timer) }
  }))
  phase('child processes stopped')
  // Only isolated test service logs; never read .env or existing user data.
  for (const [index, service] of children.entries()) {
    if (service.log()) writeFileSync(join(outputDir, `service-${index}.log`), service.log())
  }
  rmSync(dir, { recursive: true, force: true })
  phase('temporary database removed')
}
