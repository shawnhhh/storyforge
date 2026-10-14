import { createApp } from './app.js'
import { config } from './config/env.js'
import { openDatabase } from './db/database.js'

const database = openDatabase(config.dataDir)
const server = createApp(database).listen(config.port, config.host, () => {
  console.info(`StoryForge local service: http://${config.host}:${config.port}`)
})

server.on('error', (error) => {
  database.close()
  console.error(error)
  process.exitCode = 1
})

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  server.close(() => {
    database.close()
  })
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
