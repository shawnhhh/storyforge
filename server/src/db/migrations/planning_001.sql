CREATE TABLE planning_workspaces (
  novel_id TEXT PRIMARY KEY REFERENCES novels(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK(version > 0)
);
CREATE TABLE planning_records (
  novel_id TEXT NOT NULL REFERENCES planning_workspaces(novel_id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('outlines','plotlines','cards','foreshadows')),
  position INTEGER NOT NULL CHECK(position >= 0),
  data TEXT NOT NULL CHECK(json_valid(data) AND json_type(data) = 'object'),
  PRIMARY KEY(novel_id, id)
);
CREATE TABLE planning_chapter_links (
  novel_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('chapterIds','plantedChapterIds','plannedChapterIds','resolvedChapterIds')),
  PRIMARY KEY(novel_id, record_id, chapter_id, role),
  FOREIGN KEY(novel_id, record_id) REFERENCES planning_records(novel_id, id) ON DELETE CASCADE
);
CREATE INDEX planning_links_chapter ON planning_chapter_links(chapter_id);
CREATE TRIGGER planning_chapter_scope BEFORE INSERT ON planning_chapter_links
WHEN NOT EXISTS (SELECT 1 FROM chapters WHERE id = NEW.chapter_id AND novel_id = NEW.novel_id)
BEGIN SELECT RAISE(ABORT, 'Chapter belongs to another novel'); END;
-- Chapter removal invalidates open planning snapshots as well as cascading links.
CREATE TRIGGER planning_chapter_removed BEFORE DELETE ON chapters
BEGIN UPDATE planning_workspaces SET version = version + 1 WHERE novel_id = OLD.novel_id; END;
