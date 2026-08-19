-- Enable Row Level Security on all public tables.
--
-- Purpose: close Supabase's auto-exposed PostgREST surface so anon-key
-- callers can't read these tables. The API uses a direct Postgres
-- connection as the table-owner role (RLS-bypassing by default), so
-- enabling RLS does NOT break Drizzle queries. No policies are needed
-- because nothing in the ecosystem uses PostgREST for data access:
-- urantia-accounts uses Supabase JS only for auth/sessions.
--
-- Idempotent — safe to re-run.

-- Content tables (Papers, Bible, cross-references)
ALTER TABLE parts                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE papers                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE sections                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE paragraphs               ENABLE ROW LEVEL SECURITY;
ALTER TABLE entities                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE entity_translations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE paragraph_entities       ENABLE ROW LEVEL SECURITY;
ALTER TABLE paragraph_translations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE title_translations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_chunks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_verses             ENABLE ROW LEVEL SECURITY;
ALTER TABLE bible_parallels          ENABLE ROW LEVEL SECURITY;
ALTER TABLE urantia_parallels        ENABLE ROW LEVEL SECURITY;

-- Auth + per-user tables (sensitive)
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookmarks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE reading_progress         ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences         ENABLE ROW LEVEL SECURITY;
ALTER TABLE apps                     ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_consents            ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user_data            ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens           ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_codes               ENABLE ROW LEVEL SECURITY;
