CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  category TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array'),
  fields TEXT NOT NULL CHECK(json_valid(fields) AND json_type(fields) = 'object'),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(novel_id, id)
);
CREATE TABLE world_entries (
  id TEXT PRIMARY KEY,
  novel_id TEXT NOT NULL REFERENCES novels(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
  category TEXT NOT NULL CHECK(category IN ('location','organization','power','history','other')),
  tags TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(tags) AND json_type(tags) = 'array'),
  description TEXT NOT NULL DEFAULT '',
  time_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK(sort_order BETWEEN -1000000000 AND 1000000000),
  on_timeline INTEGER NOT NULL DEFAULT 0 CHECK(on_timeline IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(novel_id, id)
);
CREATE TABLE character_relations (
  novel_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(length(trim(kind)) BETWEEN 1 AND 80),
  PRIMARY KEY(novel_id, source_id, target_id, kind),
  CHECK(source_id <> target_id),
  FOREIGN KEY(novel_id, source_id) REFERENCES characters(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, target_id) REFERENCES characters(novel_id, id) ON DELETE CASCADE
);
CREATE INDEX character_relations_target ON character_relations(novel_id, target_id);
CREATE TABLE character_world_links (
  novel_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  PRIMARY KEY(novel_id, character_id, world_id),
  FOREIGN KEY(novel_id, character_id) REFERENCES characters(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, world_id) REFERENCES world_entries(novel_id, id) ON DELETE CASCADE
);
CREATE INDEX character_world_links_world ON character_world_links(novel_id, world_id);
CREATE INDEX characters_novel ON characters(novel_id);
CREATE INDEX world_entries_novel_category ON world_entries(novel_id, category, sort_order);
