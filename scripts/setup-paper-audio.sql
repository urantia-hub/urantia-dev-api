-- The full audio file of each paper and its time map (scripts/generate-paper-audio-timing.ts).
-- Run one time on the database, with Kelson's approval. Safe to run again. RLS on papers stays on.

ALTER TABLE papers ADD COLUMN IF NOT EXISTS audio jsonb;
