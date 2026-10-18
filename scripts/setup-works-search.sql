-- Search, release 3 (2026-10-18): keyword search of the Bible and the other works.
-- Run once on each database after scripts/setup-search.sql, with Kelson's approval for production.
-- Idempotent. The match_text rule must stay the same as `normalizedSql` in src/lib/search-text.ts.

ALTER TABLE bible_verses ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(text, ''::text))) STORED;
ALTER TABLE bible_verses ADD COLUMN IF NOT EXISTS match_text text
  GENERATED ALWAYS AS ((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(text), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) STORED;
CREATE INDEX IF NOT EXISTS bv_fts_gin_idx ON bible_verses USING gin (search_vector);
CREATE INDEX IF NOT EXISTS bv_match_text_trgm_idx ON bible_verses USING gin (match_text gin_trgm_ops);

ALTER TABLE scripture_passages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(text, ''::text))) STORED;
ALTER TABLE scripture_passages ADD COLUMN IF NOT EXISTS match_text text
  GENERATED ALWAYS AS ((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(text), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) STORED;
CREATE INDEX IF NOT EXISTS sp_fts_gin_idx ON scripture_passages USING gin (search_vector);
CREATE INDEX IF NOT EXISTS sp_match_text_trgm_idx ON scripture_passages USING gin (match_text gin_trgm_ops);
