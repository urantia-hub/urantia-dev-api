-- Search, release 3 (2026-10-18): keyword search of the Bible and the other works.
-- Run once on each database with psql -f, after scripts/setup-search.sql, with Kelson's approval for production.
-- Idempotent. Each ALTER rewrites its table (about 2 seconds here: these tables hold no vectors).
-- lock_timeout: the ALTER gives up when it waits for a lock, so it never queues the reads behind it.
-- The trigram index expression must stay the same as `normalizedSql` in src/lib/search-text.ts.

SET lock_timeout = '5s';

ALTER TABLE bible_verses ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(text, ''::text))) STORED;
CREATE INDEX CONCURRENTLY IF NOT EXISTS bv_fts_gin_idx ON bible_verses USING gin (search_vector);
CREATE INDEX CONCURRENTLY IF NOT EXISTS bv_match_text_trgm_idx ON bible_verses USING gin (((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(text), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) gin_trgm_ops);

ALTER TABLE scripture_passages ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english'::regconfig, COALESCE(text, ''::text))) STORED;
CREATE INDEX CONCURRENTLY IF NOT EXISTS sp_fts_gin_idx ON scripture_passages USING gin (search_vector);
CREATE INDEX CONCURRENTLY IF NOT EXISTS sp_match_text_trgm_idx ON scripture_passages USING gin (((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(text), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) gin_trgm_ops);
