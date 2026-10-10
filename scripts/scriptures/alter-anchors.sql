-- The words that take a browser to one passage on the public page of its work. Null: the page only.
-- Filled by scripts/scriptures/anchors.ts.
ALTER TABLE scripture_chunks ADD COLUMN IF NOT EXISTS anchor text;
