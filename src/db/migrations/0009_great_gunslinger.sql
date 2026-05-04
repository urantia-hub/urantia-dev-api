CREATE TABLE "bible_parallels" (
	"id" serial PRIMARY KEY NOT NULL,
	"direction" text NOT NULL,
	"paragraph_id" text NOT NULL,
	"bible_chunk_id" text NOT NULL,
	"similarity" real NOT NULL,
	"rank" integer NOT NULL,
	"source" text DEFAULT 'semantic' NOT NULL,
	"embedding_model" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bible_parallels" ADD CONSTRAINT "bible_parallels_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bible_parallels" ADD CONSTRAINT "bible_parallels_bible_chunk_id_bible_chunks_id_fk" FOREIGN KEY ("bible_chunk_id") REFERENCES "public"."bible_chunks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bp_para_direction_rank_idx" ON "bible_parallels" USING btree ("paragraph_id","direction","rank");--> statement-breakpoint
CREATE INDEX "bp_bible_direction_rank_idx" ON "bible_parallels" USING btree ("bible_chunk_id","direction","rank");--> statement-breakpoint
CREATE UNIQUE INDEX "bp_natural_key_idx" ON "bible_parallels" USING btree ("direction","paragraph_id","bible_chunk_id","source");