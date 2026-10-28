import { Music3Provider, localMusic3Transport } from './modules/studio/music/music3.js'
import { LocalAsyncProvider } from './modules/studio/jobs.js'
import { MockCreativeProvider } from './modules/studio/provider.js'
import { MediaStore } from './modules/studio/media.js'
import { join } from 'node:path'
import { configuredBudget } from './modules/studio/costs.js'
import { ServerKeyVault, redact } from './modules/studio/secrets.js'
import { openStudioDatabase } from './modules/studio/database.js'
import { StudioStore } from './modules/studio/store.js'
import { TrashStore } from './modules/trash/store.js'
import { createApp } from './app.js'
import { config } from './config/env.js'
import { openDatabase } from './db/database.js'
import { BackupService } from './modules/backups/service.js'
import { acquireServiceLock } from './db/service-lock.js'

const releaseLock = acquireServiceLock(config.dataDir)
const database = openDatabase(config.dataDir)
const studioDatabase = openStudioDatabase(config.dataDir)
const backups = new BackupService(database, config.backupDir)
const trash = new TrashStore(database)
function cleanTrash() {
  if (backups.busy) return
  try { trash.cleanup() } catch (error) { console.error('回收站清理失败，数据已保留，下次重试：', error) }
}
const cleanupTimer = setInterval(cleanTrash, 60 * 60 * 1000)
cleanupTimer.unref()
// Health must not advertise readiness while the initial backup still blocks writes.
await backups.start()
const master=process.env.STORYFORGE_MEDIA_VAULT_MASTER
const vault=master?new ServerKeyVault(join(config.dataDir,'server-keys'),Buffer.from(master,'base64')):undefined
const providers=[new LocalAsyncProvider(new MockCreativeProvider())] as import('./modules/studio/jobs.js').AsyncCreativeProvider[]
if(process.env.STORYFORGE_MUSIC3_ENABLE==='selfhost')providers.push(new Music3Provider(studioDatabase,new MediaStore(studioDatabase),localMusic3Transport(process.env.STORYFORGE_MUSIC3_ENDPOINT??'http://127.0.0.1:8000/v1/audio/speech',vault)))
const studioStore = new StudioStore(studioDatabase,undefined,providers,configuredBudget(),vault)
const server = createApp(database, backups, undefined, studioStore).listen(config.port, config.host, () => {
  console.info(`StoryForge local service: http://${config.host}:${config.port}`)
  cleanTrash()
})

server.on('error', (error) => {
  studioStore.jobs.stop()
  studioDatabase.close()
  database.close()
  releaseLock()
  console.error(redact(error instanceof Error?{name:error.name,message:error.message}:error))
  process.exitCode = 1
})

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  clearInterval(cleanupTimer)
  server.close(async () => {
    await backups.stop()
    studioStore.jobs.stop()
    studioDatabase.close()
    database.close()
    releaseLock()
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
