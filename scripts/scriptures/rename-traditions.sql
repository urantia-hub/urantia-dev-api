-- Works, round 3 (2026-10-18): the older works name their tradition in the short form of the newer
-- ones ("Hindu", not "Hinduism"). Kelson approved it. Run once with psql -f.
BEGIN;
UPDATE scripture_corpora SET religion = 'Cynic' WHERE religion = 'Cynicism';
UPDATE scripture_corpora SET religion = 'Buddhist' WHERE religion = 'Buddhism';
UPDATE scripture_corpora SET religion = 'Hindu' WHERE religion = 'Hinduism';
UPDATE scripture_corpora SET religion = 'Japanese (Shinto)' WHERE religion = 'Shinto';
UPDATE scripture_corpora SET religion = 'Taoist' WHERE religion = 'Taoism';
UPDATE scripture_corpora SET religion = 'Confucian' WHERE religion = 'Confucianism';
UPDATE scripture_corpora SET religion = 'Muslim' WHERE religion = 'Islam';
UPDATE scripture_corpora SET religion = 'Sikh' WHERE religion = 'Sikhism';
COMMIT;
