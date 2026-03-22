CREATE TABLE "paragraph_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"paragraph_id" text NOT NULL,
	"language" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"text" text NOT NULL,
	"html_text" text NOT NULL,
	"source" text DEFAULT 'urantia.dev' NOT NULL,
	"confidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "title_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"language" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"source" text DEFAULT 'urantia.dev' NOT NULL,
	"confidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paragraph_translations" ADD CONSTRAINT "paragraph_translations_paragraph_id_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."paragraphs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pt_paragraph_lang_version_idx" ON "paragraph_translations" USING btree ("paragraph_id","language","version");--> statement-breakpoint
CREATE INDEX "pt_language_idx" ON "paragraph_translations" USING btree ("language");--> statement-breakpoint
CREATE INDEX "pt_paragraph_id_idx" ON "paragraph_translations" USING btree ("paragraph_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tt_type_source_lang_version_idx" ON "title_translations" USING btree ("source_type","source_id","language","version");--> statement-breakpoint
CREATE INDEX "tt_language_idx" ON "title_translations" USING btree ("language");--> statement-breakpoint
CREATE INDEX "tt_source_type_id_idx" ON "title_translations" USING btree ("source_type","source_id");