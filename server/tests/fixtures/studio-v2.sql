-- Frozen PR #32 e6d4891 schema; synthetic fixtures only.

      CREATE TABLE studio_projects(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('music','video')), title TEXT NOT NULL, content TEXT NOT NULL, settings TEXT NOT NULL, version INTEGER NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL);
      CREATE TABLE studio_versions(id INTEGER PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), version INTEGER NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL, settings TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(projectId,version));
      CREATE TABLE studio_assets(id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL, data BLOB NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE studio_tasks(id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id), provider TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL, prompt TEXT NOT NULL, assetId TEXT REFERENCES studio_assets(id), error TEXT, createdAt TEXT NOT NULL);
      PRAGMA user_version=1;
    
CREATE TABLE studio_imports(digest TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES studio_projects(id)); PRAGMA user_version=2;
