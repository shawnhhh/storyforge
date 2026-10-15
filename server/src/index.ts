import { createApp } from './app.js'
import { config } from './config/env.js'
import { openDatabase } from './db/database.js'
import { BackupService } from './modules/backups/service.js'
import { acquireServiceLock } from './db/service-lock.js'

const releaseLock = acquireServiceLock(config.dataDir)
const database = openDatabase(config.dataDir)
const backups = new BackupService(database, config.backupDir)
const server = createApp(database, backups).listen(config.port, config.host, () => {
  console.info(`StoryForge local service: http://${config.host}:${config.port}`)
  backups.start()
})

server.on('error', (error) => {
  database.close()
  releaseLock()
  console.error(error)
  process.exitCode = 1
})

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  server.close(async () => {
    await backups.stop()
    database.close()
    releaseLock()
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
