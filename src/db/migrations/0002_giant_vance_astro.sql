CREATE TABLE "app_user_data" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apps" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"secret_hash" text NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"scopes" text[] NOT NULL,
	"owner_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"scopes" text[] NOT NULL,
	"code_challenge" text,
	"redirect_uri" text NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app_id" text DEFAULT 'default' NOT NULL,
	"paragraph_id" text NOT NULL,
	"paper_id" text NOT NULL,
	"paper_section_id" text NOT NULL,
	"paper_section_paragraph_id" text NOT NULL,
	"category" text,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_translations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"language" text NOT NULL,
	"source" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"aliases" text[],
	"description" text,
	"confidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app_id" text DEFAULT 'default' NOT NULL,
	"paragraph_id" text NOT NULL,
	"paper_id" text NOT NULL,
	"paper_section_id" text NOT NULL,
	"paper_section_paragraph_id" text NOT NULL,
	"text" text NOT NULL,
	"format" text DEFAULT 'plain' NOT NULL,
	"visibility" text DEFAULT 'private' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"app_id" text DEFAULT 'default' NOT NULL,
	"paragraph_id" text NOT NULL,
	"paper_id" text NOT NULL,
	"paper_section_id" text NOT NULL,
	"paper_section_paragraph_id" text NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "app_user_data" ADD CONSTRAINT "app_user_data_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_data" ADD CONSTRAINT "app_user_data_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_codes" ADD CONSTRAINT "auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_translations" ADD CONSTRAINT "entity_translations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_user_data_app_user_key_idx" ON "app_user_data" USING btree ("app_id","user_id","key");--> statement-breakpoint
CREATE INDEX "app_user_data_app_user_idx" ON "app_user_data" USING btree ("app_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bookmarks_user_paragraph_app_idx" ON "bookmarks" USING btree ("user_id","paragraph_id","app_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_id_idx" ON "bookmarks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookmarks_user_paper_idx" ON "bookmarks" USING btree ("user_id","paper_id");--> statement-breakpoint
CREATE INDEX "et_entity_lang_idx" ON "entity_translations" USING btree ("entity_id","language");--> statement-breakpoint
CREATE INDEX "et_lang_source_idx" ON "entity_translations" USING btree ("language","source");--> statement-breakpoint
CREATE UNIQUE INDEX "et_entity_lang_source_version_idx" ON "entity_translations" USING btree ("entity_id","language","source","version");--> statement-breakpoint
CREATE INDEX "notes_user_id_idx" ON "notes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notes_user_paper_idx" ON "notes" USING btree ("user_id","paper_id");--> statement-breakpoint
CREATE INDEX "notes_user_paragraph_idx" ON "notes" USING btree ("user_id","paragraph_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reading_progress_user_paragraph_app_idx" ON "reading_progress" USING btree ("user_id","paragraph_id","app_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_id_idx" ON "reading_progress" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reading_progress_user_paper_idx" ON "reading_progress" USING btree ("user_id","paper_id");