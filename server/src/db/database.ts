import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { migrate } from './migrate.js'
import { migratePlanning } from './planning-migrate.js'

// Only the composition root opens a database; importing this module has no side effects.
export function openDatabase(dataDir: string): DatabaseSync {
  mkdirSync(dataDir, { recursive: true })
  const database = new DatabaseSync(join(dataDir, 'storyforge.sqlite'))
  try {
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;')
    // Base and module upgrades form one startup transaction. A rejected module
    // must not leave an existing database partially upgraded.
    database.exec('BEGIN IMMEDIATE')
    migrate(database)
    migratePlanning(database)
    database.exec('COMMIT')
    return database
  } catch (error) {
    if (database.isTransaction) database.exec('ROLLBACK')
    database.close()
    throw error
  }
}
