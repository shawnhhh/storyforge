import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Separate module DB preserves the frozen novel backup schema and never migrates it. */
export function openStudioDatabase(dataDir: string) {
  mkdirSync(dataDir, { recursive: true })
  const db = new DatabaseSync(join(dataDir, 'studio.sqlite'))
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE')
    const version = Number(db.prepare('PRAGMA user_version').get()!.user_version)
    if (version > 3) throw new Error('Studio database is newer than this application')
    if (version === 0) db.exec(`
      CREATE TABLE studio_projects(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('music','video')), title TEXT NOT NULL, content TEXT NOT NULL, settings TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE studio_versions(id INTEGER PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), version INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, settings TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(projectId,version));
      CREATE TABLE studio_assets(id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, data BLOB NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE studio_tasks(id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), provider TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL, prompt TEXT NOT NULL, assetId TEXT REFERENCES studio_assets(id), error TEXT, createdAt TEXT NOT NULL);
      PRAGMA user_version=1;
    `)
    db.exec('CREATE TABLE IF NOT EXISTS studio_imports(digest TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id)); PRAGMA user_version=3')
    db.exec('CREATE TABLE IF NOT EXISTS unified_restores(digest TEXT NOT NULL, module TEXT NOT NULL, PRIMARY KEY(digest,module))')
    db.exec('CREATE TABLE IF NOT EXISTS unified_drafts(id TEXT PRIMARY KEY, payload TEXT NOT NULL)')
    db.exec('COMMIT')
    // A process interruption never leaves a job claiming it is still executing.
    db.prepare("UPDATE studio_tasks SET status='failed', error='服务重启，请重新生成', progress=0 WHERE status IN ('queued','running')").run()
    return db
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); throw error }
}
