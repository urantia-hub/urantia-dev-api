-- scripture_work_parallels: for each chunk of a work, the 10 nearest chunks of the other works and of
-- the Bible (text-embedding-3-large). Filled by work-parallels.ts. It only creates a new table, with RLS on.
BEGIN;
CREATE TABLE "scripture_work_parallels" (
	"chunk_id" text NOT NULL REFERENCES "public"."scripture_chunks"("id") ON DELETE CASCADE,
	"rank" smallint NOT NULL,
	"other_chunk_id" text REFERENCES "public"."scripture_chunks"("id") ON DELETE CASCADE,
	"other_bible_chunk_id" text REFERENCES "public"."bible_chunks"("id") ON DELETE CASCADE,
	"similarity" real NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL,
	PRIMARY KEY ("chunk_id", "rank"),
	CONSTRAINT "swp_one_other" CHECK (num_nonnulls("other_chunk_id", "other_bible_chunk_id") = 1)
);
ALTER TABLE "scripture_work_parallels" ENABLE ROW LEVEL SECURITY;
CREATE INDEX "swp_other_chunk_idx" ON "scripture_work_parallels" USING btree ("other_chunk_id");
COMMIT;
