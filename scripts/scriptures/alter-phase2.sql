-- World religions layer, phase 2: refs with up to three levels, corpus notes,
-- and texts with no Paper 131 heading. Adds nullable columns and one default only.
BEGIN;
ALTER TABLE "scripture_corpora" ADD COLUMN "ref_levels" integer DEFAULT 2 NOT NULL;
ALTER TABLE "scripture_corpora" ADD COLUMN "notes" text;
ALTER TABLE "scripture_corpora" ALTER COLUMN "urantia_section" DROP NOT NULL;
ALTER TABLE "scripture_passages" ADD COLUMN "subdivision" integer;
UPDATE "scripture_corpora" SET "ref_levels" = 1 WHERE "id" = 'dhammapada-muller-1881';
COMMIT;
