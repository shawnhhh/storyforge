import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

export const schemaVersion = 4
const migrations = ['0001_novels.sql', '0002_story_bible.sql', '0003_writing_dashboard.sql', '0004_knowledge.sql']
export function migrate(database: DatabaseSync, target = schemaVersion) {
  if (!Number.isInteger(target) || target < 1 || target > schemaVersion) throw new Error('Invalid migration target')
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    if (versions.some((row, index) => row.version !== index + 1 || Number(row.version) > target)) throw new Error('Database schema is newer than this application or migration history is invalid')
    for (let version = 1; version <= target; version++) {
      if (versions.some(row => row.version === version)) continue
      const sql = readFileSync(new URL(`./migrations/${migrations[version - 1]}`, import.meta.url), 'utf8')
      database.exec(sql)
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
