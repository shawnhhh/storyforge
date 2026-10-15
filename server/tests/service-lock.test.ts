import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireServiceLock } from '../src/db/service-lock.js'

test('a SQLite process lease excludes a second service and can be reacquired without deleting files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'storyforge-lock-test-'))
  try {
    const release = acquireServiceLock(dir)
    assert.throws(() => acquireServiceLock(dir), /已有服务/)
    release(); release()
    const secondRelease = acquireServiceLock(dir)
    assert.throws(() => acquireServiceLock(dir), /已有服务/)
    secondRelease()
    rmSync(join(dir, '.storyforge-service-lock.sqlite'))
    symlinkSync(join(dir, 'untrusted.sqlite'), join(dir, '.storyforge-service-lock.sqlite'))
    assert.throws(() => acquireServiceLock(dir), /服务锁路径不安全/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
