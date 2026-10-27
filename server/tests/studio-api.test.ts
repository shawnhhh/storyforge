import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { openDatabase } from '../src/db/database.js'
import { openStudioDatabase } from '../src/modules/studio/database.js'
import { StudioStore } from '../src/modules/studio/store.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { createApp } from '../src/app.js'

test('studio HTTP validates origin, versions, assets and exports without changing novel schema', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-studio-api-'))
  const db = openDatabase(dir), studio = openStudioDatabase(dir)
  new NovelStore(db).create('目录小说', '')
  const schema = db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all()
  const server = createApp(db, undefined, undefined, new StudioStore(studio)).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address(); assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}/api/studio`
  const request = (path: string, method = 'GET', body?: unknown, origin?: string) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  try {
    assert.equal((await request('/projects', 'POST', { kind: 'music', title: 'x' }, 'https://evil.example')).status, 403)
    assert.equal((await request('/projects', 'POST', { kind: 'unknown', title: 'x' })).status, 400)
    const created = await request('/projects', 'POST', { kind: 'music', title: 'HTTP歌曲' }); assert.equal(created.status, 201)
    const p = await created.json() as { id: string; title: string; version: number; content: string; settings: object }
    const catalog = await (await request('/catalog')).json() as { module: string; title: string }[]
    assert.deepEqual(catalog.map(p => p.module).sort(), ['music', 'story'])
    assert.equal(catalog.find(p => p.module === 'story')!.title, '目录小说')
    assert.equal((await request(`/projects/${p.id}`, 'PUT', { ...p, version: 0 })).status, 409)
    assert.equal((await request(`/projects/${p.id}`, 'PUT', { ...p, content: '歌词', settings: { tempo: 99 } })).status, 200)
    assert.equal((await request(`/projects/${p.id}/assets`, 'POST', { name: 'html', mime: 'text/html', data: 'YWJj' })).status, 400)
    const asset = await (await request(`/projects/${p.id}/assets`, 'POST', { name: 'audio.wav', mime: 'audio/wav', data: 'YWJj' })).json() as { id: string }
    const media = await request(`/assets/${asset.id}/content`); assert.equal(media.headers.get('x-content-type-options'), 'nosniff'); assert.equal(await media.text(), 'abc')
    const exported = await (await request(`/projects/${p.id}/export`)).json() as { assets: { data: string }[]; history: unknown[] }
    assert.equal(exported.history.length, 2); assert.equal(exported.assets[0].data, 'YWJj')
    assert.deepEqual(db.prepare('SELECT name,sql FROM sqlite_schema ORDER BY name').all(), schema)
    assert.equal(studio.prepare('PRAGMA integrity_check').get()!.integrity_check, 'ok')
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); studio.close(); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
