import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

export const schemaVersion = 4
const migrations = ['0001_novels.sql', '0002_story_bible.sql', '0003_writing_dashboard.sql', '0004_knowledge.sql']
const migrationSql = (name: string) => readFileSync(new URL(`./migrations/${name}`, import.meta.url), 'utf8')

// The two unmerged branches both used v3. Recognize their exact module DDL,
// including indexes and triggers, before upgrading either shape to unified v4.
function moduleSignature(database: DatabaseSync) {
  return JSON.stringify(database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
    WHERE name NOT LIKE 'sqlite_%' AND (name GLOB 'writing_*' OR name GLOB 'knowledge_*' OR tbl_name GLOB 'writing_*' OR tbl_name GLOB 'knowledge_*')
    ORDER BY type,name`).all())
}
const v3Signatures = migrations.slice(2).map(name => {
  const reference = new DatabaseSync(':memory:')
  try { reference.exec(migrationSql(name)); return moduleSignature(reference) }
  finally { reference.close() }
})
export function migrate(database: DatabaseSync, target = schemaVersion) {
  if (!Number.isInteger(target) || target < 1 || target > schemaVersion) throw new Error('Invalid migration target')
  database.exec('BEGIN IMMEDIATE')
  try {
    database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
    const versions = database.prepare('SELECT version FROM schema_migrations ORDER BY version').all()
    if (versions.some((row, index) => row.version !== index + 1 || Number(row.version) > target)) throw new Error('Database schema is newer than this application or migration history is invalid')
    let knowledgeAlreadyApplied = false
    if (versions.length === 3) {
      const variant = v3Signatures.indexOf(moduleSignature(database))
      if (variant < 0) throw new Error('Unsupported or incomplete v3 database schema; no data was changed')
      knowledgeAlreadyApplied = variant === 1
      if (knowledgeAlreadyApplied && target >= 4) database.exec(migrationSql(migrations[2]))
    }
    for (let version = 1; version <= target; version++) {
      if (versions.some(row => row.version === version)) continue
      if (!(version === 4 && knowledgeAlreadyApplied)) database.exec(migrationSql(migrations[version - 1]))
      database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString())
    }
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}
