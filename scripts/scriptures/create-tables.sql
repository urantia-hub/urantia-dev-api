-- World religions layer, phase 1: the four scripture_* tables.
-- Generated from src/db/schema.ts with drizzle-kit (only these tables), then
-- applied by hand: the drizzle snapshots in src/db/migrations are stale.
-- It only creates new tables. Run it once.
BEGIN;
CREATE TABLE "scripture_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"corpus_id" text NOT NULL,
	"label" text NOT NULL,
	"sort_start" integer NOT NULL,
	"sort_end" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(3072),
	"embedding_small" vector(1536),
	"embedding_model" text
);
ALTER TABLE "scripture_chunks" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "scripture_corpora" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"ref_prefix" text NOT NULL,
	"religion" text NOT NULL,
	"title" text NOT NULL,
	"translator" text NOT NULL,
	"year" integer NOT NULL,
	"source_url" text NOT NULL,
	"license" text NOT NULL,
	"urantia_section" text NOT NULL,
	"division_label" text NOT NULL,
	"unit_label" text NOT NULL,
	"passage_count" integer NOT NULL,
	"sort_order" integer NOT NULL
);
ALTER TABLE "scripture_corpora" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "scripture_parallels" (
	"id" serial PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"paragraph_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"corpus_id" text NOT NULL,
	"similarity" real NOT NULL,
	"rank" integer NOT NULL,
	"source" text DEFAULT 'semantic' NOT NULL,
	"embedding_model" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "scripture_parallels" ENABLE ROW LEVEL SECURITY;
CREATE TABLE "scripture_passages" (
	"id" text PRIMARY KEY NOT NULL,
	"corpus_id" text NOT NULL,
	"ref" text NOT NULL,
	"sort" integer NOT NULL,
	"division" integer NOT NULL,
	"division_title" text,
	"number_start" integer NOT NULL,
	"number_end" integer NOT NULL,
	"text" text NOT NULL,
	"chunk_id" text
);
ALTER TABLE "scripture_passages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scripture_chunks" ADD CONSTRAINT "scripture_chunks_corpus_id_scripture_corpora_id_fk" FOREIGN KEY ("corpus_id") REFERENCES "public"."scripture_corpora"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_parallels" ADD CONSTRAINT "scripture_parallels_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_parallels" ADD CONSTRAINT "scripture_parallels_chunk_id_scripture_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."scripture_chunks"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_parallels" ADD CONSTRAINT "scripture_parallels_corpus_id_scripture_corpora_id_fk" FOREIGN KEY ("corpus_id") REFERENCES "public"."scripture_corpora"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_passages" ADD CONSTRAINT "scripture_passages_corpus_id_scripture_corpora_id_fk" FOREIGN KEY ("corpus_id") REFERENCES "public"."scripture_corpora"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scripture_passages" ADD CONSTRAINT "scripture_passages_chunk_id_scripture_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."scripture_chunks"("id") ON DELETE no action ON UPDATE no action;
CREATE INDEX "sch_corpus_sort_idx" ON "scripture_chunks" USING btree ("corpus_id","sort_start");
CREATE INDEX "sch_embedding_small_hnsw_idx" ON "scripture_chunks" USING hnsw ("embedding_small" vector_cosine_ops) WITH (m=16,ef_construction=64);
CREATE UNIQUE INDEX "sco_slug_idx" ON "scripture_corpora" USING btree ("slug");
CREATE UNIQUE INDEX "sco_ref_prefix_idx" ON "scripture_corpora" USING btree ("ref_prefix");
CREATE INDEX "spar_para_direction_idx" ON "scripture_parallels" USING btree ("paragraph_id","direction","corpus_id","rank");
CREATE INDEX "spar_chunk_direction_idx" ON "scripture_parallels" USING btree ("chunk_id","direction","rank");
CREATE UNIQUE INDEX "spar_natural_key_idx" ON "scripture_parallels" USING btree ("direction","paragraph_id","chunk_id","source");
CREATE UNIQUE INDEX "sp_corpus_sort_idx" ON "scripture_passages" USING btree ("corpus_id","sort");
CREATE INDEX "sp_corpus_division_idx" ON "scripture_passages" USING btree ("corpus_id","division");
CREATE INDEX "sp_chunk_id_idx" ON "scripture_passages" USING btree ("chunk_id");
COMMIT;
