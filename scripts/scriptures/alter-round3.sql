-- Works, round 3 (2026-10-18): what each work is, names in references, and works with no link.
-- Adds columns with defaults only. Run once with psql -f, with Kelson's approval for production.
BEGIN;
ALTER TABLE scripture_corpora ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'scripture';
ALTER TABLE scripture_corpora ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE scripture_corpora ADD COLUMN IF NOT EXISTS division_names text[];
ALTER TABLE scripture_corpora ADD COLUMN IF NOT EXISTS linked boolean NOT NULL DEFAULT true;
UPDATE scripture_corpora SET kind = 'classic', summary = 'The lives and sayings of Diogenes and the other Cynic philosophers.' WHERE id = 'diogenes-laertius-6-hicks-1925';
UPDATE scripture_corpora SET kind = 'classic', summary = 'Epictetus on the life and calling of a Cynic philosopher.' WHERE id = 'epictetus-3-22-oldfather-1928';
UPDATE scripture_corpora SET kind = 'scripture', summary = 'A collection of the Buddha''s sayings in verse.' WHERE id = 'dhammapada-muller-1881';
UPDATE scripture_corpora SET kind = 'scripture', summary = 'Krishna''s teaching to the warrior Arjuna, from the Mahabharata.' WHERE id = 'bhagavad-gita-besant-1922';
UPDATE scripture_corpora SET kind = 'classic', summary = 'Oracles of the Shinto gods, from Aston''s study of Shinto.' WHERE id = 'shinto-oracles-aston-1905';
UPDATE scripture_corpora SET kind = 'classic', summary = 'The short classic of the Tao, attributed to Laozi.' WHERE id = 'tao-te-ching-legge-1891';
UPDATE scripture_corpora SET kind = 'classic', summary = 'The sayings of Confucius, recorded by his students.' WHERE id = 'analects-legge-1861';
UPDATE scripture_corpora SET kind = 'scripture', summary = 'The scripture of Islam.' WHERE id = 'koran-pickthall-1930';
UPDATE scripture_corpora SET kind = 'scripture', summary = 'The opening hymn of the Sikh scripture, by Guru Nanak.' WHERE id = 'japji-macauliffe-1909';
COMMIT;
