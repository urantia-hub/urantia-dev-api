# Unified Auth Layer for the Urantia Ecosystem

**Date:** 2026-03-18
**Updated:** 2026-03-19
**Status:** In Progress (Phases 1-3 complete)

## Problem

The Urantia developer ecosystem has no shared identity layer. UrantiaHub has its own auth (NextAuth + Prisma), urantia-dev-api is fully public, and third-party apps (Gabriel's SpiritualTranslations, Urantiapedia, etc.) would each need to build their own user system. This means:

- Users create separate accounts for every Urantia app
- Bookmarks, notes, and reading progress are locked inside individual apps
- Third-party developers must build auth from scratch

## Solution

A shared identity + user data layer for the Urantia community, powered by Supabase Auth (open-source, already in the stack) with portable user data on api.urantia.dev.

## Architecture

```
Third-Party Apps
  │ "Sign in with Urantia" button (drop-in script or @urantia/auth SDK)
  │
  ▼
id.urantia.dev (Branded Login Page)
  │ "Sign in to Urantia" — [Google] [Email magic link]
  │ Consent screen for third-party apps
  │ Supabase Auth under the hood (invisible to users)
  │
  ▼
api.urantia.dev
  │ PUBLIC (existing, unchanged):
  │   GET /papers, /paragraphs, /search, /entities, /audio, /cite, /og, /embeddings, /toc
  │
  │ AUTHENTICATED (new, under /me):
  │   Bookmarks, Notes, Reading Progress, App-specific Data
  │
  │ AUTH INFRA (new, under /auth):
  │   OAuth endpoints, token exchange
  │
  ▼
Supabase (existing)
  │ Auth (GoTrue) — identity provider
  │ Postgres — existing content tables + new user data tables
```

### Key principles

- All existing public endpoints unchanged — zero breaking changes
- Supabase is invisible to end users (branded as "Urantia")
- Open source auth backend (GoTrue) eliminates vendor lock-in
- Incremental cost: effectively $0 (uses existing Supabase plan)

---

## Data Model

### New tables (Drizzle, in existing Supabase Postgres)

```sql
-- Users (synced from Supabase Auth via lazy creation)
users
  id                          UUID PK          -- matches Supabase Auth user ID
  email                       TEXT UNIQUE
  name                        TEXT
  avatar_url                  TEXT
  created_at                  TIMESTAMP
  updated_at                  TIMESTAMP

-- Bookmarks (paragraph-level)
bookmarks
  id                          UUID PK DEFAULT gen_random_uuid()
  user_id                     UUID FK → users(id) ON DELETE CASCADE
  paragraph_id                TEXT NOT NULL     -- paragraphs.globalId (e.g. "0:1.1")
  paper_id                    TEXT NOT NULL     -- denormalized for fast queries
  paper_section_id            TEXT NOT NULL     -- denormalized
  paper_section_paragraph_id  TEXT NOT NULL     -- denormalized
  category                    TEXT              -- user-defined string, nullable
  created_at                  TIMESTAMP
  updated_at                  TIMESTAMP
  UNIQUE(user_id, paragraph_id)

-- Notes (paragraph-level, markdown-capable)
notes
  id                          UUID PK DEFAULT gen_random_uuid()
  user_id                     UUID FK → users(id) ON DELETE CASCADE
  paragraph_id                TEXT NOT NULL
  paper_id                    TEXT NOT NULL
  paper_section_id            TEXT NOT NULL
  paper_section_paragraph_id  TEXT NOT NULL
  text                        TEXT NOT NULL
  format                      TEXT DEFAULT 'plain'  -- 'plain' or 'markdown'
  created_at                  TIMESTAMP
  updated_at                  TIMESTAMP

-- Reading progress (paragraph-level)
reading_progress
  id                          UUID PK DEFAULT gen_random_uuid()
  user_id                     UUID FK → users(id) ON DELETE CASCADE
  paragraph_id                TEXT NOT NULL
  paper_id                    TEXT NOT NULL
  paper_section_id            TEXT NOT NULL
  paper_section_paragraph_id  TEXT NOT NULL
  read_at                     TIMESTAMP
  UNIQUE(user_id, paragraph_id)

-- User preferences (flexible JSONB)
user_preferences
  user_id                     UUID PK FK → users(id) ON DELETE CASCADE
  preferences                 JSONB DEFAULT '{}'
  updated_at                  TIMESTAMP

-- Auth codes (short-lived, for OAuth flow)
auth_codes
  code                        TEXT PK
  app_id                      TEXT FK → apps(id) ON DELETE CASCADE
  user_id                     UUID FK → users(id) ON DELETE CASCADE
  scopes                      TEXT[] NOT NULL
  code_challenge              TEXT             -- PKCE
  redirect_uri                TEXT NOT NULL
  expires_at                  TIMESTAMP NOT NULL

-- App registry (OAuth clients)
apps
  id                          TEXT PK          -- human-readable slug, e.g. "urantiahub"
  name                        TEXT NOT NULL
  secret_hash                 TEXT NOT NULL     -- hashed app secret
  redirect_uris               TEXT[] NOT NULL   -- allowed callback URLs
  scopes                      TEXT[] NOT NULL   -- allowed scopes
  created_at                  TIMESTAMP

-- App-specific user data (sandboxed key-value per app per user)
app_user_data
  id                          UUID PK DEFAULT gen_random_uuid()
  app_id                      TEXT FK → apps(id) ON DELETE CASCADE
  user_id                     UUID FK → users(id) ON DELETE CASCADE
  key                         TEXT NOT NULL
  value                       JSONB NOT NULL
  created_at                  TIMESTAMP
  updated_at                  TIMESTAMP
  UNIQUE(app_id, user_id, key)
```

### Indexes

```sql
CREATE INDEX idx_bookmarks_user_id ON bookmarks(user_id);
CREATE INDEX idx_bookmarks_user_paper ON bookmarks(user_id, paper_id);

CREATE INDEX idx_notes_user_id ON notes(user_id);
CREATE INDEX idx_notes_user_paper ON notes(user_id, paper_id);
CREATE INDEX idx_notes_user_paragraph ON notes(user_id, paragraph_id);

CREATE INDEX idx_reading_progress_user_id ON reading_progress(user_id);
CREATE INDEX idx_reading_progress_user_paper ON reading_progress(user_id, paper_id);

CREATE INDEX idx_app_user_data_app_user ON app_user_data(app_id, user_id);
```

### Design decisions

- **Reference IDs:** All four reference IDs (`paragraph_id`/`globalId`, `paper_id`, `paper_section_id`, `paper_section_paragraph_id`) are stored as denormalized text strings. These match UrantiaHub's existing pattern and are computed values (e.g., `paper_section_id` = `"1:2"` meaning Paper 1, Section 2). They are NOT foreign keys to the content tables — they are denormalized copies for fast querying. The API validates them against the content tables on write.
- **`paragraph_id` naming:** Holds the `globalId` value (e.g., `"0:1.1"`). Named `paragraph_id` because `globalId` is the API's term for what is conceptually a paragraph identifier.
- **Bookmark `category`** is a free-text string field (not a separate table) — simple, matches existing UrantiaHub behavior.
- **Notes allow multiple per paragraph** — unlike bookmarks and reading_progress (one per user-paragraph pair), a user can have multiple notes on the same paragraph.
- **Notes format:** `plain` or `markdown`. Apps that want rich editing use markdown editors; simple apps ignore formatting.
- **`app_user_data`** is sandboxed: apps can only read/write their own keys, enforced at API level.
- **`ON DELETE CASCADE`** everywhere for GDPR-friendly account deletion.
- **User sync:** Lazy creation on first authenticated API request. When a valid Supabase JWT arrives and no matching `users` row exists, the middleware creates one from the JWT claims (sub, email, user_metadata.full_name, user_metadata.avatar_url). No webhook or Postgres trigger needed.
- **Apps registry:** `apps.id` is a human-readable text slug chosen during registration (e.g., "urantiahub").
- **Admin access:** Determined by checking user ID against an `ADMIN_USER_IDS` environment variable (comma-separated UUIDs).
- **Interests and shares** deliberately excluded for now (to be revisited later).
- **UrantiaHub-specific fields** (`lastVisited*`, email preferences, `isAdmin`) will live in `user_preferences` JSONB or `app_user_data` under the "urantiahub" app scope.

---

## API Endpoints

### Authenticated — all require `Authorization: Bearer <supabase_jwt>`

```
# User profile
GET    /me                              → user profile
PUT    /me                              → update name, avatar
DELETE /me                              → delete account + all data

# Bookmarks
GET    /me/bookmarks                    → list (?paper_id=, ?category=, ?page=, ?limit=)
GET    /me/bookmarks/categories         → distinct categories for user
POST   /me/bookmarks                    → create
DELETE /me/bookmarks/:id                → delete

# Notes
GET    /me/notes                        → list (?paper_id=, ?paragraph_id=)
POST   /me/notes                        → create
PUT    /me/notes/:id                    → update text
DELETE /me/notes/:id                    → delete

# Reading progress
GET    /me/reading-progress             → per-paper completion percentages
POST   /me/reading-progress             → mark paragraph(s) as read (batch)
DELETE /me/reading-progress/:id         → unmark by ID
DELETE /me/reading-progress?paper_id=X  → unmark entire paper
DELETE /me/reading-progress?paragraph_id=X → unmark specific paragraph

# Preferences
GET    /me/preferences                  → get preferences JSONB
PUT    /me/preferences                  → shallow merge into existing

# App-specific data
GET    /me/app-data                     → all key-value pairs for calling app
GET    /me/app-data/:key                → single value
PUT    /me/app-data/:key                → set value
DELETE /me/app-data/:key                → delete value
```

### Auth infrastructure

```
GET  /auth/authorize                    → OAuth authorization endpoint (Authorization Code + PKCE)
POST /auth/callback                     → OAuth callback from Supabase
POST /auth/token                        → exchange authorization code for tokens
POST /auth/apps                         → register an app (admin-only)
```

### Token strategy

- **Token type:** Supabase JWTs (signed with the project's JWT secret)
- **Validation on Cloudflare Workers:** Use the `jose` library (Web Crypto API compatible) to verify JWT signatures. The JWT secret is stored as a Worker environment variable (`SUPABASE_JWT_SECRET`).
- **First-party apps (UrantiaHub, demo app):** Use Supabase client SDK directly → get a Supabase session JWT → pass to API as `Authorization: Bearer <token>`. No OAuth redirect needed.
- **Third-party apps:** Use Authorization Code + PKCE flow via `/auth/authorize` → id.urantia.dev login → `/auth/callback` → `/auth/token` returns a scoped Supabase JWT.
- **Authorization codes:** Short-lived (5 min), stored in `auth_codes` table. Deleted after use.
- **Refresh tokens:** Handled by Supabase Auth natively.
- **Scope enforcement:** Auth middleware extracts scopes from the JWT custom claims and checks against the requested endpoint. A token with only `bookmarks` scope gets 403 on `/me/notes`.

### Scopes

- `profile` — read user name/email/avatar
- `bookmarks` — read/write bookmarks
- `notes` — read/write notes
- `reading-progress` — read/write progress
- `preferences` — read/write user preferences
- `app-data` — read/write app-specific data (sandboxed)

### Per-user rate limits

- Authenticated endpoints: 100 req/min per user (in addition to existing 200 req/min per IP)
- Storage quotas: max 10,000 bookmarks, max 10,000 notes, max 100KB per note, max 1,000 app-data keys per app per user

---

## accounts.urantiahub.com — Branded Login Page

**Project:** `urantia-accounts/` — separate Next.js 15 App Router app on Vercel.
**Domain:** accounts.urantiahub.com (OIDC issuer URL, permanent per RFC 8414).

- **Tech:** Next.js 15 (App Router) + Tailwind + @supabase/ssr
- **Zero database deps** — pure UI + redirect orchestrator
- **Features:**
  - `/login` — "Sign in to your Urantia account" with Google + email magic link
  - `/authorize` — OAuth consent screen for third-party apps
  - `/callback` — Supabase Auth redirect handler
  - `/verify` — "Check your email" confirmation
  - `/.well-known/openid-configuration` — OIDC discovery document
  - First-party apps (FIRST_PARTY_APP_IDS) skip consent

---

## Developer Integration

### Drop-in script tag (easiest)

```html
<script src="https://accounts.urantiahub.com/sdk.js" data-app-id="your-app-id"></script>
<!-- Renders a "Sign in with Urantia" button -->
<!-- Click → popup → login → callback with token -->
```

### NPM package

```js
import { UrantiaAuth } from '@urantia/auth'
const auth = new UrantiaAuth({ appId: 'your-app-id' })
const { user, token } = await auth.signIn()
```

### NPM package organization

- **Org:** `@urantia` on npmjs.com (owner: `urantiahub`)
- **`@urantia/auth`** — auth SDK (signIn, signOut, token management)
- **`@urantia/api`** — typed client for api.urantia.dev (papers, search, entities, etc.)
- Independent packages — install only what you need

### Developer onboarding

1. Visit `urantia.dev/developers` (docs page)
2. Register app → get `app_id` + `app_secret`
3. Pick integration method (script tag or npm)
4. Done

---

## CORS

The existing CORS middleware already allows `Authorization` header and `origin: *`. Sufficient for third-party browser apps calling authenticated endpoints. No changes needed.

---

## Implementation Phases

Each phase is independently shippable.

### Phase 1: Auth infrastructure on api.urantia.dev — DONE

- Supabase Auth enabled (Google OAuth + email magic link)
- 8 Drizzle tables: users, bookmarks, notes, reading_progress, user_preferences, apps, app_user_data, auth_codes
- JWT validation middleware via Supabase JWKS (`jose` library)
- Lazy user creation from JWT claims
- 142 tests pass (9 auth-specific)

### Phase 2: User data endpoints (/me/*) — DONE

- `src/routes/me.ts` — 14 authenticated endpoints (profile, bookmarks, notes, reading progress, preferences)
- `src/routes/auth.ts` — 4 OAuth endpoints (app registration, authorization codes, token exchange)
- `src/validators/me-schemas.ts` — Zod schemas for all request/response types
- `src/lib/paragraph-lookup.ts` — Shared ref resolution + batch paragraph enrichment
- App-tagged data model (appId + visibility columns for forward compatibility)
- Responses include full paragraph entities (same shape as GET /paragraphs/:ref)
- All ref lists ordered by sortId ascending

### Phase 3: accounts.urantiahub.com (Branded Login Page) — DONE

- `urantia-accounts/` — Next.js 15 App Router + Tailwind + @supabase/ssr
- Login page, consent screen, callback handler, OIDC discovery
- Deployed to Vercel at accounts.urantiahub.com
- Zero database deps — delegates to Supabase Auth + api.urantia.dev

### Phase 4: Developer SDKs — TODO

- `@urantia/auth` — npm package for signIn/signOut/token management
- Drop-in `<script>` tag that renders "Sign in with Urantia" button
- `@urantia/api` — typed client for api.urantia.dev (separate package)
- Monorepo: `urantia-dev-sdks/` with npm workspaces
- Developer docs at urantia.dev/developers

### Phase 5: Demo app — TODO

- Build a lightweight demo app that exercises the full auth + user data flow
- Shows "Sign in with Urantia" → create bookmarks/notes → view reading progress
- Validates the entire stack end-to-end before touching UrantiaHub's ~100 users
- Serves as reference implementation for third-party devs

### Phase 6 (future): UrantiaHub migration — TODO

- Deferred until auth layer is proven via the demo app
- Replace NextAuth with Supabase Auth
- Move user data operations to api.urantia.dev/me/* endpoints
- Remove local user tables from Prisma schema

---

## Verification

### Phase 1
- `bun test` passes (existing tests still green)
- New migration applied: `bun run db:push`
- JWT middleware correctly rejects invalid tokens on /me/* routes
- JWT middleware allows public routes through without auth

### Phase 2
- Integration tests for each /me/* endpoint (create, read, update, delete)
- Test scope enforcement (token with only `bookmarks` scope can't access notes)
- Test app-data sandboxing (app A can't read app B's data)

### Phase 3
- Login flow works end-to-end: click "Sign in" → Google/email → redirect back with token
- Consent screen appears for third-party apps
- Token can be used to call /me/* endpoints

### Phase 4
- `npm install @urantia/auth` → `auth.signIn()` works
- Drop-in script tag renders button and completes auth flow
- `npm install @urantia/api` → typed client fetches papers

### Phase 5
- Demo app loads, shows "Sign in with Urantia" button
- Full flow: sign in → browse papers → bookmark/note/mark as read → sign out → sign back in → data persists
- All /me/* endpoints working correctly

### Phase 6 (future)
- UrantiaHub sign-in works with new auth
- Bookmarks, notes, reading progress work through API
- No regressions in existing UrantiaHub functionality

---

## What stays the same

- All existing public API endpoints — zero changes
- UrantiaHub's UI and features (until Phase 6)
- Rate limiting, logging, caching — unchanged
- Content data model — unchanged
