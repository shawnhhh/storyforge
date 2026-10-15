import { join } from 'node:path'
import { openDatabase } from '../../src/db/database.js'
import { BackupService } from '../../src/modules/backups/service.js'

// Only launched by restore-crash.test.ts with its own mkdtemp directory.
const [directory, id] = process.argv.slice(2)
if (!directory || !id) throw new Error('A temporary fixture directory and backup ID are required')
const database = openDatabase(join(directory, 'data'))
const backups = new BackupService(database, join(directory, 'backups'))
const prepared = backups.prepare(id)
await backups.restore(id, prepared.token, '替换当前全部数据', () => { process.kill(process.pid, 'SIGKILL') })
throw new Error('Crash injection did not execute')
