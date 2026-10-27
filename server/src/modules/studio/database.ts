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
    if (version > 6) throw new Error('Studio database is newer than this application')
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS studio_jobs(taskId TEXT PRIMARY KEY REFERENCES studio_tasks(id), provider TEXT NOT NULL, model TEXT NOT NULL, key TEXT NOT NULL UNIQUE, digest TEXT NOT NULL, snapshot TEXT NOT NULL, remoteId TEXT, attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL, deadline INTEGER NOT NULL, lease TEXT, leaseUntil INTEGER NOT NULL DEFAULT 0, cancel INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS studio_job_events(id INTEGER PRIMARY KEY, taskId TEXT NOT NULL REFERENCES studio_tasks(id), status TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_jobs_due ON studio_jobs(due,leaseUntil);
      CREATE TABLE IF NOT EXISTS studio_media_objects(digest TEXT PRIMARY KEY, bytes INTEGER NOT NULL, createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS studio_media_refs(id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), name TEXT NOT NULL, mime TEXT NOT NULL, digest TEXT NOT NULL REFERENCES studio_media_objects(digest), createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_media_refs_digest ON studio_media_refs(digest);
      CREATE TABLE IF NOT EXISTS studio_uploads(id TEXT PRIMARY KEY,projectId TEXT NOT NULL REFERENCES studio_projects(id),name TEXT NOT NULL,mime TEXT NOT NULL,bytes INTEGER NOT NULL,digest TEXT NOT NULL,offset INTEGER NOT NULL,kind TEXT NOT NULL,createdAt INTEGER NOT NULL,result TEXT);
      CREATE TABLE IF NOT EXISTS studio_cost_quotes(token TEXT PRIMARY KEY,digest TEXT NOT NULL,amount INTEGER NOT NULL,expires INTEGER NOT NULL,price TEXT NOT NULL,taskId TEXT);
      CREATE TABLE IF NOT EXISTS studio_cost_reservations(taskId TEXT PRIMARY KEY REFERENCES studio_tasks(id),month TEXT NOT NULL,reserved INTEGER NOT NULL,spent INTEGER NOT NULL,status TEXT NOT NULL,price TEXT NOT NULL,createdAt INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS studio_cost_month ON studio_cost_reservations(month);
      PRAGMA user_version=6;
    `)
    db.exec('COMMIT')
    // A process interruption never leaves a job claiming it is still executing.
    db.prepare("UPDATE studio_tasks SET status='failed', error='服务重启，请重新生成', progress=0 WHERE status IN ('queued','running') AND id NOT IN (SELECT taskId FROM studio_jobs)").run()
    return db
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); throw error }
}
