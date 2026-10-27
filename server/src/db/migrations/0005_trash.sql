-- Active tables remain unchanged: deleted rows and their associations are archived
-- together, before any FK cascade, in the same SQLite transaction.
CREATE TABLE trash_entries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload TEXT NOT NULL CHECK(json_valid(payload) AND json_type(payload)='object'),
  CHECK(expires_at > deleted_at)
) STRICT;
CREATE INDEX trash_expiration ON trash_entries(expires_at);
CREATE INDEX trash_novel ON trash_entries(novel_id);
