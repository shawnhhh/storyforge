import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

// Independent of the numbered base migrations: PR #3 owns base version 2.
export function migratePlanning(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec('CREATE TABLE IF NOT EXISTS planning_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = db.prepare('SELECT name FROM planning_migrations ORDER BY name').all()
    if (applied.some(row => row.name !== 'planning/001')) throw new Error('Planning database schema is newer than this application')
    if (!applied.length) {
      db.exec(readFileSync(new URL('./migrations/planning_001.sql', import.meta.url), 'utf8'))
      db.prepare('INSERT INTO planning_migrations VALUES (?, ?)').run('planning/001', new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) { db.exec('ROLLBACK'); throw error }
}
