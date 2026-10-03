-- Remove duplicate (paragraph_id, entity_id) rows, then add the primary key that
-- src/db/schema.ts declares. One transaction: on any error nothing changes.
-- Run once: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/dedupe-paragraph-entities.sql
BEGIN;

DELETE FROM paragraph_entities a
USING paragraph_entities b
WHERE a.paragraph_id = b.paragraph_id
  AND a.entity_id = b.entity_id
  AND a.ctid > b.ctid;

ALTER TABLE paragraph_entities
  ADD CONSTRAINT paragraph_entities_paragraph_id_entity_id_pk
  PRIMARY KEY (paragraph_id, entity_id);

SELECT count(*) AS rows_after FROM paragraph_entities;

COMMIT;
