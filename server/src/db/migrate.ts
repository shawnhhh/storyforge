import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

export function migrate(database: DatabaseSync) {
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    if (versions.some(row => Number(row.version) > 1)) throw new Error('Database schema is newer than this application')
    if (!versions.some(row => row.version === 1)) {
      const sql = readFileSync(new URL('./migrations/0001_novels.sql', import.meta.url), 'utf8')
      database.exec(sql)
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString())
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
