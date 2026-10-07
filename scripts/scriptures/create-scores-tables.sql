-- Scripture scores: paragraph_scripture_scores and scripture_mutual_pairs.
-- It only creates new tables, with RLS on. Run it once.
BEGIN;
CREATE TABLE "paragraph_scripture_scores" (
	"paragraph_id" text PRIMARY KEY NOT NULL,
	"texts_close" integer NOT NULL,
	"consensus" real NOT NULL,
	"distance" real NOT NULL,
	"lean_corpus" text,
	"lean_gap" real,
	"profile" jsonb NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "paragraph_scripture_scores" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "scripture_mutual_pairs" (
	"id" serial PRIMARY KEY NOT NULL,
	"paragraph_id" text NOT NULL,
	"corpus_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"similarity" real NOT NULL,
	"similarity_small" real NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "scripture_mutual_pairs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "paragraph_scripture_scores" ADD CONSTRAINT "paragraph_scripture_scores_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_mutual_pairs" ADD CONSTRAINT "scripture_mutual_pairs_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "pss_consensus_idx" ON "paragraph_scripture_scores" USING btree ("consensus");
CREATE INDEX "pss_distance_idx" ON "paragraph_scripture_scores" USING btree ("distance");
CREATE INDEX "pss_lean_idx" ON "paragraph_scripture_scores" USING btree ("lean_corpus","lean_gap");
CREATE UNIQUE INDEX "smp_para_corpus_idx" ON "scripture_mutual_pairs" USING btree ("paragraph_id","corpus_id");
CREATE INDEX "smp_corpus_sim_idx" ON "scripture_mutual_pairs" USING btree ("corpus_id","similarity");
COMMIT;
