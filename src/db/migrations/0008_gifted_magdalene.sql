CREATE TABLE "bible_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"book_code" text NOT NULL,
	"chapter" integer NOT NULL,
	"verse_start" integer NOT NULL,
	"verse_end" integer NOT NULL,
	"text" text NOT NULL,
	"embedding" vector(3072),
	"embedding_model" text
);
--> statement-breakpoint
ALTER TABLE "bible_verses" ADD COLUMN "paragraph_index" integer;--> statement-breakpoint
ALTER TABLE "bible_verses" ADD COLUMN "chunk_id" text;--> statement-breakpoint
ALTER TABLE "paragraphs" ADD COLUMN "embedding_v2" vector(3072);--> statement-breakpoint
CREATE INDEX "bc_book_chapter_idx" ON "bible_chunks" USING btree ("book_code","chapter");--> statement-breakpoint
CREATE INDEX "bc_book_chapter_start_idx" ON "bible_chunks" USING btree ("book_code","chapter","verse_start");--> statement-breakpoint
CREATE INDEX "bv_chunk_id_idx" ON "bible_verses" USING btree ("chunk_id");