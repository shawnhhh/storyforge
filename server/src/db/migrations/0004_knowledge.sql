-- Additive: reuse characters, world_entries and their existing associations.
CREATE TABLE knowledge_workspaces (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0)
);
CREATE TABLE knowledge_links (
  novel_id TEXT NOT NULL REFERENCES knowledge_workspaces(novel_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  source_world_id TEXT,
  source_chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
  target_world_id TEXT,
  target_character_id TEXT,
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
  note TEXT NOT NULL CHECK(length(note) <= 2000),
  PRIMARY KEY(novel_id, id),
  CHECK((source_world_id IS NOT NULL) + (source_chapter_id IS NOT NULL) = 1),
  CHECK((target_world_id IS NOT NULL) + (target_character_id IS NOT NULL) = 1),
  CHECK(source_world_id IS NULL OR (target_world_id IS NOT NULL AND source_world_id <> target_world_id)),
  FOREIGN KEY(novel_id, source_world_id) REFERENCES world_entries(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, target_world_id) REFERENCES world_entries(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, target_character_id) REFERENCES characters(novel_id, id) ON DELETE CASCADE
);
CREATE TRIGGER knowledge_chapter_scope BEFORE INSERT ON knowledge_links
WHEN NEW.source_chapter_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chapters WHERE id=NEW.source_chapter_id AND novel_id=NEW.novel_id
)
BEGIN SELECT RAISE(ABORT, 'Chapter belongs to another novel'); END;
-- A cascading deletion must invalidate every open association snapshot.
CREATE TRIGGER knowledge_link_removed AFTER DELETE ON knowledge_links
BEGIN UPDATE knowledge_workspaces SET version=version+1 WHERE novel_id=OLD.novel_id; END;
CREATE INDEX knowledge_links_world ON knowledge_links(novel_id, target_world_id);
CREATE INDEX knowledge_links_character ON knowledge_links(novel_id, target_character_id);
CREATE INDEX knowledge_links_chapter ON knowledge_links(source_chapter_id);
CREATE TRIGGER knowledge_chapter_scope_update BEFORE UPDATE ON knowledge_links
WHEN NEW.source_chapter_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM chapters WHERE id=NEW.source_chapter_id AND novel_id=NEW.novel_id
)
BEGIN SELECT RAISE(ABORT, 'Chapter belongs to another novel'); END;
