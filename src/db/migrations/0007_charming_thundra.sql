CREATE TABLE "bible_verses" (
	"id" text PRIMARY KEY NOT NULL,
	"book_code" text NOT NULL,
	"book_name" text NOT NULL,
	"book_order" integer NOT NULL,
	"canon" text NOT NULL,
	"chapter" integer NOT NULL,
	"verse" integer NOT NULL,
	"text" text NOT NULL,
	"paragraph_marker" text,
	"translation" text DEFAULT 'web' NOT NULL,
	"source_version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "bv_book_chapter_verse_idx" ON "bible_verses" USING btree ("book_code","chapter","verse");--> statement-breakpoint
CREATE INDEX "bv_book_order_idx" ON "bible_verses" USING btree ("book_order");--> statement-breakpoint
CREATE INDEX "bv_canon_idx" ON "bible_verses" USING btree ("canon");