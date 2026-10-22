BEGIN;
UPDATE entities SET aliases = ARRAY['Joshua ben Joseph']::text[] WHERE id = 'jesus';
INSERT INTO paragraph_entities (paragraph_id, entity_id) SELECT paragraph_id, 'jesus' FROM paragraph_entities WHERE entity_id = 'joshua-ben-joseph' ON CONFLICT DO NOTHING;
DELETE FROM paragraph_entities WHERE entity_id = 'joshua-ben-joseph';
DELETE FROM entity_translations WHERE entity_id = 'joshua-ben-joseph';
DELETE FROM entities WHERE id = 'joshua-ben-joseph';
UPDATE entities SET citation_count = (SELECT count(*) FROM paragraph_entities WHERE entity_id = 'jesus') WHERE id = 'jesus';
COMMIT;
