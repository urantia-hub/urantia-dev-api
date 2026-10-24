-- Spanish keyword search (2026-10-23): a trigram index on the normalized Spanish text.
-- Run once on each database, with Kelson's approval for production. Idempotent.
-- The expression must stay the same as `normalizedSqlEs` in src/lib/search-text-es.ts, and the query
-- must say language = 'es' as a literal, so the planner can use this partial index.
-- Run with psql -f (CONCURRENTLY cannot run inside a transaction).
CREATE INDEX CONCURRENTLY IF NOT EXISTS pt_es_match_text_trgm_idx
  ON paragraph_translations USING gin (((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(translate(lower(text), 'áéíóúüñàèìòù', 'aeiouunaeiou'), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) gin_trgm_ops)
  WHERE language = 'es';
