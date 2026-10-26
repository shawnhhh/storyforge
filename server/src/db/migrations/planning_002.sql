-- Reuse story-bible identities; never copy character/location documents.
CREATE TABLE planning_character_links (
  novel_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  PRIMARY KEY(novel_id, record_id, character_id),
  FOREIGN KEY(novel_id, record_id) REFERENCES planning_records(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, character_id) REFERENCES characters(novel_id, id) ON DELETE CASCADE
);
CREATE TABLE planning_world_links (
  novel_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  PRIMARY KEY(novel_id, record_id, world_id),
  FOREIGN KEY(novel_id, record_id) REFERENCES planning_records(novel_id, id) ON DELETE CASCADE,
  FOREIGN KEY(novel_id, world_id) REFERENCES world_entries(novel_id, id) ON DELETE CASCADE
);
CREATE INDEX planning_character_target ON planning_character_links(novel_id, character_id);
CREATE INDEX planning_world_target ON planning_world_links(novel_id, world_id);
-- Future trash integration: soft deletion must similarly invalidate snapshots
-- and hide links; restoring a target must not resurrect stale browser writes.
CREATE TRIGGER planning_character_removed BEFORE DELETE ON characters
BEGIN
  UPDATE planning_workspaces SET version=version+1 WHERE novel_id=OLD.novel_id
    AND EXISTS (SELECT 1 FROM planning_character_links WHERE novel_id=OLD.novel_id AND character_id=OLD.id);
END;
CREATE TRIGGER planning_world_removed BEFORE DELETE ON world_entries
BEGIN
  UPDATE planning_workspaces SET version=version+1 WHERE novel_id=OLD.novel_id
    AND EXISTS (SELECT 1 FROM planning_world_links WHERE novel_id=OLD.novel_id AND world_id=OLD.id);
END;
