-- Create the feedback table for POST /feedback.
--
-- Purpose: add this one table without `bun run db:push`. A push compares the
-- whole schema, and it disables Row Level Security on every table that
-- scripts/setup-rls.sql enabled. This file matches the `feedback` table in
-- src/db/schema.ts.
--
-- Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"message" text NOT NULL,
	"ref" text,
	"endpoint" text,
	"request_id" text,
	"client" text,
	"contact" text,
	"page_url" text,
	"ip_hash" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- No policies: only the API's direct Postgres connection reads or writes it.
ALTER TABLE "feedback" ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS "feedback_created_at_idx" ON "feedback" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "feedback_category_idx" ON "feedback" USING btree ("category");
