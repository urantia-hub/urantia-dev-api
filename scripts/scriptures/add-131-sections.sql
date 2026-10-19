-- Works, round 3 (2026-10-19): five later works have the tradition of a Paper 131 section but no
-- `urantia_section`. Kelson approved it. Run once; a row that has a section stays as it is.
BEGIN;
UPDATE scripture_corpora SET urantia_section = '131:4' WHERE slug IN ('rig-veda', 'upanishads') AND urantia_section IS NULL;
UPDATE scripture_corpora SET urantia_section = '131:8' WHERE slug = 'chuang-tzu' AND urantia_section IS NULL;
UPDATE scripture_corpora SET urantia_section = '131:9' WHERE slug = 'shu-king' AND urantia_section IS NULL;
UPDATE scripture_corpora SET urantia_section = '131:7' WHERE slug = 'kojiki' AND urantia_section IS NULL;
COMMIT;
