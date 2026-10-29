import test from 'node:test'
import assert from 'node:assert/strict'
import { request } from 'node:http'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApp } from '../src/app.js'
import { openDatabase } from '../src/db/database.js'

test('all JSON parser limits reject compressed bodies including trailing bytes before decompression; identity JSON still works', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sf-http-body-')), db = openDatabase(dir), server = createApp(db).listen(0, '127.0.0.1')
  try {
    await new Promise<void>(r => server.once('listening', r))
    const address = server.address(); assert.ok(address && typeof address !== 'string')
    const send = (path: string, body: Buffer, encoding: string) => new Promise<number>((ok, fail) => {
      const r = request({ host: '127.0.0.1', port: address.port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Encoding': encoding } }, res => { res.resume(); res.once('end', () => ok(res.statusCode!)) }); r.on('error', fail); r.end(body)
    })
    const json = Buffer.from(JSON.stringify({ title: '合成请求', description: '' }))
    for (const path of ['/api/novels', '/api/unified-backups/export', '/api/studio/import/preview']) for (const body of [gzipSync(json), Buffer.concat([gzipSync(json), Buffer.from('trailing')])]) assert.equal(await send(path, body, 'gzip'), 415)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM novels').get()!.n, 0)
    assert.equal(await send('/api/novels', json, 'identity'), 201)
  } finally { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }) }
})
