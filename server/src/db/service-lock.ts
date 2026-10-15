import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// A separate SQLite lock database provides an OS-backed process lease. It is
// never part of the user's novel database or its snapshots. Process death releases
// the lease automatically, without racy PID checks or deleting database files.
export function acquireServiceLock(dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  const path = join(dataDir, '.storyforge-service-lock.sqlite')
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error('服务锁路径不安全，启动已停止')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
  }
  const lock = new DatabaseSync(path)
  try {
    chmodSync(path, 0o600)
    lock.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE')
  } catch (error) {
    lock.close()
    if (error instanceof Error && 'errcode' in error && (error.errcode === 5 || error.errcode === 6)) throw new Error('此数据目录已有服务运行；请先关闭它，再启动 StoryForge', { cause: error })
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try { lock.exec('ROLLBACK') } finally { lock.close() }
  }
}
