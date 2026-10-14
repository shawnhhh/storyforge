import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const port = Number(process.env.SERVER_PORT ?? 3001)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SERVER_PORT must be an integer between 1 and 65535')
}

export const config = {
  host: '127.0.0.1',
  port,
  dataDir: resolve(projectRoot, process.env.STORYFORGE_DATA_DIR ?? 'data'),
}
