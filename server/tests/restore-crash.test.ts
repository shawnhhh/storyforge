import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../src/db/database.js'
import { NovelStore } from '../src/modules/novels/store.js'
import { BackupService } from '../src/modules/backups/service.js'

test('killing the process midway through restore leaves pre-restore WAL data intact on reopen', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'storyforge-restore-crash-'))
  let database = openDatabase(join(directory, 'data'))
  let opened = true
  let child: ReturnType<typeof spawn> | undefined
  try {
    const novels = new NovelStore(database), backups = new BackupService(database, join(directory, 'backups'))
    novels.create('备份时', '')
    const target = await backups.create()
    novels.create('恢复前必须保留', '进程崩溃回滚测试')
    const before = novels.list()
    database.close(); opened = false
    child = spawn(process.execPath, ['--import', 'tsx', 'server/tests/fixtures/crash-restore.ts', directory, target.id], { stdio: ['ignore', 'pipe', 'pipe'] })
    let log = ''
    child.stderr!.on('data', data => { log += data })
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child!.once('error', reject)
      child!.once('exit', (code, signal) => resolve({ code, signal }))
    })
    assert.equal(result.signal, 'SIGKILL', log)
    database = openDatabase(join(directory, 'data')); opened = true
    assert.deepEqual(new NovelStore(database).list(), before)
    assert.equal(database.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok')
    const safety = new BackupService(database, join(directory, 'backups')).history().entries.find(entry => entry.kind === 'before-restore')
    assert.ok(safety)
  } finally {
    if (child?.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    if (opened) database.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
