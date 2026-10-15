import { resolve, relative, isAbsolute, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url))
const port = Number(process.env.SERVER_PORT ?? 3001)
const backupDir = resolve(process.env.STORYFORGE_BACKUP_DIR ?? resolve(homedir(), 'Library/Application Support/StoryForge/Backups'))
const backupRelative = relative(projectRoot, backupDir)
if (backupRelative === '' || (backupRelative.split(sep)[0] !== '..' && !isAbsolute(backupRelative))) throw new Error('STORYFORGE_BACKUP_DIR must be outside the project directory')
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SERVER_PORT must be an integer between 1 and 65535')
}

export const config = {
  host: '127.0.0.1',
  port,
  dataDir: resolve(projectRoot, process.env.STORYFORGE_DATA_DIR ?? 'data'),
  backupDir,
}
