# urantia-dev-api

AI/developer-first API for the Urantia Papers.

## Tech Stack

- Runtime: Bun
- Framework: Hono + @hono/zod-openapi
- ORM: Drizzle
- Database: Supabase (Postgres + pgvector)
- Validation: Zod v4
- Linting: Biome

## Commands

- `bun run dev` — Start dev server with hot reload
- `bun run seed` — Seed database from JSON files
- `bun run db:generate` — Generate Drizzle migrations
- `bun run db:push` — Push schema to database
- `bun run typecheck` — Type check
- `bun run lint` — Lint with Biome

## Project Structure

- `src/index.ts` — Hono app entry point
- `src/db/schema.ts` — Drizzle table definitions (content tables + auth/user tables)
- `src/db/client.ts` — Database client
- `src/lib/logger.ts` — BetterStack logger factory (dev fallback to console)
- `src/lib/errors.ts` — RFC 9457 problem+json error responses
- `src/lib/paragraph-lookup.ts` — Shared paragraph ref resolution + batch lookup
- `src/routes/` — API route handlers
  - `papers.ts`, `paragraphs.ts`, `search.ts`, `entities.ts`, `audio.ts`, `toc.ts` — Public content routes
  - `me.ts` — Authenticated user data (bookmarks, notes, reading progress, preferences)
  - `auth.ts` — OAuth endpoints (app registration, authorization codes, token exchange)
  - `cite.ts`, `og.ts`, `embeddings.ts`, `mcp.ts` — Utility routes
- `src/middleware/` — CORS, structured logging, rate limiting, cache control, JWT auth
  - `auth.ts` — Supabase JWT validation via JWKS, lazy user creation
- `src/validators/` — Zod schemas for request/response
  - `schemas.ts` — Public endpoint schemas
  - `me-schemas.ts` — Authenticated endpoint schemas
- `src/types/node.ts` — TypeScript types + ref format detection
- `scripts/seed.ts` — Database seeder from urantia-papers-json
- `scripts/setup-fts.sql` — Full-text search setup SQL
- `docs/plans/unified-auth-layer.md` — Full design spec for the unified auth layer

## SDKs

Official TypeScript SDKs published on npm (`urantia-dev-sdks/` repo):
- `@urantia/api` (v0.1.0) — Typed fetch client for all endpoints (public + authenticated)
- `@urantia/auth` (v0.1.0) — OAuth client for accounts.urantiahub.com (PKCE, popup/redirect, session management)

## Auth Layer (on `auth` branch)

The API includes a unified auth layer for the Urantia ecosystem:

- **Identity**: Supabase Auth (GoTrue) with ECC P-256 JWT signing
- **JWT validation**: Via Supabase JWKS endpoint using `jose` library
- **Login page**: accounts.urantiahub.com (separate Next.js app in `urantia-accounts/`)
- **User data tables**: users, bookmarks, notes, reading_progress, user_preferences, apps, app_user_data, auth_codes
- **Authenticated endpoints**: `/me/*` (bookmarks, notes, reading progress, preferences)
- **OAuth endpoints**: `/auth/*` (app registration, authorization codes, token exchange)
- **App-tagged data**: All user data has an `appId` column (defaults to "default", scoped per-app in future)
- **Forward compat**: `visibility` column on bookmarks/notes (private/public/group)

## Documentation

- `FEATURES.md` — Consumer-facing feature list. Keep up to date when endpoints change.
- `TODO.md` — Running list of planned work.
- `docs/plans/unified-auth-layer.md` — Design spec for the auth layer.

## Observability

- **Logging**: BetterStack via `@logtail/edge`. Structured JSON logs with request metadata.
- **Metrics**: Search queries and endpoint usage are logged as structured events to BetterStack, queryable via SQL dashboards.
- **Error tracking**: Global error handler sends stack traces to BetterStack.
- **Health check**: `GET /health` verifies DB connectivity.
- **Uptime monitoring**: BetterStack uptime monitor on `/health`.

