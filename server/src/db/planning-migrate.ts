import { readFileSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

export const planningSchemaVersion = 2
const names = ['planning/001', 'planning/002']
// Independent of numbered base migrations. Target 1 remains available for legacy validation.
export function migratePlanning(db: DatabaseSync, target = planningSchemaVersion) {
  if (!Number.isInteger(target) || target < 1 || target > planningSchemaVersion) throw new Error('Invalid planning migration target')
  if (target >= 2 && !db.prepare("SELECT 1 FROM sqlite_schema WHERE name='characters' AND type='table'").get()) throw new Error('Planning v2 requires story-bible base migration first')
  const nested = db.isTransaction
  db.exec(nested ? 'SAVEPOINT planning_migration' : 'BEGIN IMMEDIATE')
  try {
    db.exec('CREATE TABLE IF NOT EXISTS planning_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
    const applied = db.prepare('SELECT name FROM planning_migrations ORDER BY name').all()
    if (applied.some((row, index) => row.name !== names[index]) || applied.length > target) throw new Error('Planning database schema is newer than this application or migration history is invalid')
    for (let version = applied.length + 1; version <= target; version++) {
      db.exec(readFileSync(new URL(`./migrations/planning_00${version}.sql`, import.meta.url), 'utf8'))
      db.prepare('INSERT INTO planning_migrations VALUES (?, ?)').run(names[version - 1], new Date().toISOString())
    }
    db.exec(nested ? 'RELEASE planning_migration' : 'COMMIT')
  } catch (error) { db.exec(nested ? 'ROLLBACK TO planning_migration; RELEASE planning_migration' : 'ROLLBACK'); throw error }
}
