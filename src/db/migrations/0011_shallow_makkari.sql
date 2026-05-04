CREATE TABLE "paragraph_parallels" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_paragraph_id" text NOT NULL,
	"target_paragraph_id" text NOT NULL,
	"similarity" real NOT NULL,
	"rank" integer NOT NULL,
	"embedding_model" text NOT NULL,
	"generated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paragraph_parallels" ADD CONSTRAINT "paragraph_parallels_source_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("source_paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paragraph_parallels" ADD CONSTRAINT "paragraph_parallels_target_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("target_paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pp_source_rank_idx" ON "paragraph_parallels" USING btree ("source_paragraph_id","rank");--> statement-breakpoint
CREATE INDEX "pp_target_idx" ON "paragraph_parallels" USING btree ("target_paragraph_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pp_natural_key_idx" ON "paragraph_parallels" USING btree ("source_paragraph_id","target_paragraph_id");