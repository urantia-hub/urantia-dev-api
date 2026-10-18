-- Search, release 1 and 2 (2026-10-18): normalized text for exact phrases and near words.
-- Run once on each database, with Kelson's approval for production. Idempotent.
-- The column rule must stay the same as `normalizedSql` in src/lib/search-text.ts.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE paragraphs ADD COLUMN IF NOT EXISTS match_text text
  GENERATED ALWAYS AS ((' ' || btrim(regexp_replace(regexp_replace(regexp_replace(lower(text), '[''‘’ʼ]', '', 'g'), '([0-9]),(?=[0-9]{3})', '\1', 'g'), '[^a-z0-9]+', ' ', 'g')) || ' ')) STORED;

CREATE INDEX IF NOT EXISTS paragraphs_match_text_trgm_idx
  ON paragraphs USING gin (match_text gin_trgm_ops);

-- The words of each body of text, for the near-word step. Filled by scripts/fill-search-words.ts.
CREATE TABLE IF NOT EXISTS search_words (
  source text NOT NULL,
  word text NOT NULL,
  n integer NOT NULL,
  PRIMARY KEY (source, word)
);
CREATE INDEX IF NOT EXISTS search_words_word_trgm_idx
  ON search_words USING gin (word gin_trgm_ops);
ALTER TABLE search_words ENABLE ROW LEVEL SECURITY;
