import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { ChapterResult, Novel, NovelDetail } from '../../shared/contracts/novels.js'

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  return port
}
async function start(dir: string, port: number) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'server/src/index.ts'], {
    // Override both paths: process-level tests must never use user backups.
    env: { ...process.env, SERVER_PORT: String(port), STORYFORGE_DATA_DIR: dir, STORYFORGE_BACKUP_DIR: join(dir, 'backups') }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', data => { log += data })
  child.stderr.on('data', data => { log += data })
  const exited = new Promise<number | null>(resolve => { child.once('exit', resolve) })
  async function stop() {
    if (child.exitCode !== null) return
    child.kill('SIGTERM')
    const result = await Promise.race([exited, delay(4000).then(() => 'timeout')])
    if (result === 'timeout') { child.kill('SIGKILL'); await exited; assert.fail(`Server shutdown timed out: ${log}`) }
    assert.equal(result, 0, log)
  }
  const base = `http://127.0.0.1:${port}/api`
  generations.delete(base)
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child.exitCode !== null) throw new Error(log)
    try { if ((await fetch(`${base}/health`, { signal: AbortSignal.timeout(1000) })).ok) return { base, stop } } catch { /* wait for server */ }
    await delay(75)
  }
  await stop(); throw new Error(`Server startup timed out: ${log}`)
}
const generations = new Map<string, string>()
async function request(base: string, path: string, method = 'GET', body?: unknown, origin?: string) {
  if (!generations.has(base)) { const health = await fetch(base + '/health'); generations.set(base, health.headers.get('X-StoryForge-Generation')!) }
  return fetch(base + path, { method, headers: { 'Content-Type': 'application/json', 'X-StoryForge-Generation': generations.get(base)!, ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
}

test('HTTP CRUD validates input, detects conflicts and restores SQLite after a process restart', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-api-'))
  let server: Awaited<ReturnType<typeof start>> | undefined
  try {
    const port = await freePort()
    server = await start(dir, port)
    assert.equal((await request(server.base, '/novels', 'POST', { title: '' })).status, 400)
    assert.equal((await request(server.base, '/novels', 'POST', { title: '恶意来源' }, 'https://example.com')).status, 403)
    const novelResponse = await request(server.base, '/novels', 'POST', { title: '浏览器共享小说', description: '本机测试' }, 'http://127.0.0.1:5173')
    assert.equal(novelResponse.status, 201)
    const novel = await novelResponse.json() as Novel
    const first = await (await request(server.base, `/novels/${novel.id}/chapters`, 'POST', { title: '第一章', version: novel.version })).json() as ChapterResult
    assert.equal((await request(server.base, `/chapters/${first.chapter.id}`, 'PUT', { title: '非法文档', version: 1, content: { type: 'unknown' } })).status, 400)
    assert.equal((await request(server.base, `/chapters/${first.chapter.id}`, 'PUT', { title: '无版本', content: first.chapter.content })).status, 400)
    const content = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Safari 写入，Chrome 读取', marks: [{ type: 'bold' }] }] }] }
    const writtenResponse = await request(server.base, `/chapters/${first.chapter.id}`, 'PUT', { version: first.chapter.version, title: '第一章：起点', content })
    assert.equal(writtenResponse.status, 200)
    let written = await writtenResponse.json() as ChapterResult
    const stale = await request(server.base, `/chapters/${first.chapter.id}`, 'PUT', { version: first.chapter.version, title: 'Chrome 旧版本', content })
    assert.equal(stale.status, 409)
    assert.equal((await request(server.base, `/novels/${novel.id}`, 'DELETE', { version: first.novel.version, confirmed: true, name: novel.title })).status, 409)
    const base = server.base
    const simultaneous = await Promise.all(['Safari 并发保存', 'Chrome 并发保存'].map(title => request(base, `/chapters/${first.chapter.id}`, 'PUT', { version: written.chapter.version, title, content })))
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [200, 409])
    written = await simultaneous.find(response => response.status === 200)!.json() as ChapterResult
    await server.stop()
    server = await start(dir, port)
    const restored = await (await request(server.base, `/novels/${novel.id}`)).json() as NovelDetail
    assert.equal(restored.novel.title, novel.title)
    assert.equal(restored.novel.version, written.novel.version)
    const chapter = await (await request(server.base, `/chapters/${first.chapter.id}`)).json() as ChapterResult['chapter']
    assert.deepEqual(chapter.content, content)
    assert.equal(chapter.version, written.chapter.version)
    assert.equal(chapter.title, written.chapter.title)
    const renamed = await (await request(server.base, `/novels/${novel.id}`, 'PATCH', { version: restored.novel.version, title: '重命名小说', description: '已恢复' })).json() as Novel
    assert.equal(renamed.title, '重命名小说')
    assert.equal((await request(server.base, `/novels/${novel.id}`, 'DELETE', { version: renamed.version, confirmed: true, name: renamed.title })).status, 204)
    assert.equal((await request(server.base, `/chapters/${first.chapter.id}`)).status, 404)
  } finally { await server?.stop(); rmSync(dir, { recursive: true, force: true }) }
})

test('HTTP chapter order and deletion validate inputs and preserve data on rejected writes', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-api-validation-'))
  let server: Awaited<ReturnType<typeof start>> | undefined
  try {
    server = await start(dir, await freePort())
    const base = server.base
    const novel = await (await request(base, '/novels', 'POST', { title: '排序验证' })).json() as Novel
    const first = await (await request(base, `/novels/${novel.id}/chapters`, 'POST', { title: '一', version: novel.version })).json() as ChapterResult
    const second = await (await request(base, `/novels/${novel.id}/chapters`, 'POST', { title: '二', version: first.novel.version })).json() as ChapterResult
    const before = await (await request(base, `/novels/${novel.id}`)).json() as NovelDetail
    for (const chapterIds of [[first.chapter.id], [first.chapter.id, first.chapter.id], [first.chapter.id, 'unknown'], [first.chapter.id, 42]]) {
      assert.equal((await request(base, `/novels/${novel.id}/chapter-order`, 'PUT', { version: before.novel.version, chapterIds })).status, 400)
    }
    for (const version of [undefined, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
      assert.equal((await request(base, `/chapters/${first.chapter.id}`, 'PUT', { version, title: '非法版本', content: first.chapter.content })).status, 400)
    }
    for (const content of [{ type: 'doc', content: [{ type: 'unknown' }] }, { type: 'doc', content: [{ type: 'text', text: '不合法的顶层文本' }] }]) {
      assert.equal((await request(base, `/chapters/${first.chapter.id}`, 'PUT', { version: first.chapter.version, title: '非法文档', content })).status, 400)
    }
    assert.equal((await request(base, `/chapters/${first.chapter.id}`, 'PUT', { version: first.chapter.version, title: '超限', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(1024 * 1024) }] }] } })).status, 413)
    assert.deepEqual(await (await request(base, `/novels/${novel.id}`)).json(), before)
    assert.deepEqual(await (await request(base, `/chapters/${first.chapter.id}`)).json(), first.chapter)
    const reorderedResponse = await request(base, `/novels/${novel.id}/chapter-order`, 'PUT', { version: before.novel.version, chapterIds: [second.chapter.id, first.chapter.id] })
    assert.equal(reorderedResponse.status, 200)
    const reordered = await reorderedResponse.json() as NovelDetail
    assert.deepEqual(reordered.chapters.map(item => item.id), [second.chapter.id, first.chapter.id])
    assert.equal((await request(base, `/chapters/${first.chapter.id}`, 'DELETE', { version: first.chapter.version, novelVersion: before.novel.version, confirmed: true })).status, 409)
    const removedResponse = await request(base, `/chapters/${second.chapter.id}`, 'DELETE', { version: second.chapter.version, novelVersion: reordered.novel.version, confirmed: true })
    assert.equal(removedResponse.status, 200)
    const removed = await removedResponse.json() as NovelDetail
    assert.deepEqual(removed.chapters.map(item => [item.id, item.position]), [[first.chapter.id, 0]])
    assert.equal((await request(base, `/chapters/${second.chapter.id}`)).status, 404)
  } finally { await server?.stop(); rmSync(dir, { recursive: true, force: true }) }
})
