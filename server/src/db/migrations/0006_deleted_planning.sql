-- Keep identities after expiry/purge: rebasing an old draft must not recreate
-- deleted plans. No FK: this guard must also survive deletion of the novel.
CREATE TABLE deleted_planning_records (
  novel_id TEXT NOT NULL,
  id TEXT NOT NULL,
  PRIMARY KEY(novel_id, id)
);
-- Preserve the guard when upgrading a v5 recycle bin in a private restore stage.
INSERT OR IGNORE INTO deleted_planning_records
SELECT entry.novel_id, json_extract(record.value, '$.id')
FROM trash_entries entry, json_each(entry.payload, '$.rows.planning_records') record
WHERE json_type(record.value, '$.id') = 'text';
