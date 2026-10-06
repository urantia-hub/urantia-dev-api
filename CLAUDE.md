# urantia-dev-api

AI/developer-first API for the Urantia Papers — the **hub product's**
backend service.

## Scope of this service

This service owns Papers content (text, paragraphs, entities, search,
audio) and the hub product's per-user data (bookmarks, notes, reading
progress, preferences). It also hosts the shared OAuth infrastructure
(`/auth/*` — app registry, auth codes, token exchange) because that was
the natural first home for it.

**This is NOT a catch-all backend for every Urantia app.** Other product
apps get their own services with their own databases:

- `urantia-listen-api/` — Listen app (audio transcripts, semantic hits,
  streaming insights)
- future product apps — same pattern

All backends validate tokens issued by `accounts.urantiahub.com`, but each
owns its own schema, migrations, deploy, secrets, and data retention
rules. Don't bolt new product features onto this repo just because the
auth middleware is already wired up — stand up a new service.

## Tech Stack

- Runtime: Bun
- Framework: Hono + @hono/zod-openapi
- ORM: Drizzle
- Database: Supabase (Postgres + pgvector)
- Validation: Zod v4
- Linting: Biome

## Dependency and toolchain pins

- `bun.lock` is the ONLY lockfile. A stale leftover `yarn.lock` sat here until
  2026-08-19 and kept 51 Dependabot alerts open after the real deps were fixed —
  GitHub scans every lockfile it finds. Never add a second one.
- `wrangler` pinned exact `4.73.0` — 4.124+ requires Node 22 and this machine
  runs Node 20. Bumping it breaks `bun run deploy` locally.
- `@biomejs/biome` pinned exact `2.4.7` — 2.5.x changes formatting rules and
  flags untouched files. Bump it only together with a deliberate repo-wide
  `bun run format`.
- `overrides.yaml` forces the patched transitive `yaml` version.
- Known baseline (pre-existing, not regressions): 223 typecheck errors and 43
  Biome lint errors, measured 2026-09-18 on a clean `main`. Most typecheck
  errors are Hono handler return-type mismatches in `src/routes/*.ts` plus
  `unknown` body types in the test files. Compare counts against this baseline
  before blaming a change.

## Testing against production

`bun test` runs the Hono app in-process with the real `.env`, which points at
the production database. The unit/middleware suites and the content
integration suites (papers, toc, search, root, mcp, tools) are read-only and
safe. The `auth`/`me` suites can write; run them only deliberately.

In a worktree there is no `.env`, so about 200 database tests fail there. That is
expected. Compare the list of failing tests with `origin/main`, not the count
with zero.

The whole suite shares one in-memory rate limiter (200 requests per minute, IP
`unknown`) and runs close to that limit. A new test that makes several requests
must send its own `cf-connecting-ip` header, or unrelated tests start to fail
with 429. See `tests/integration/openapi.test.ts` for the pattern.

## Commands

- `bun run dev` — Start dev server with hot reload
- `bun run seed` — Seed database from JSON files
- `bun run db:generate` — Generate Drizzle migrations
- `bun run db:push` — Push schema to database (see RLS and `db:push`)
- `bun run typecheck` — Type check
- `bun run lint` — Lint with Biome
- `bun run deploy` — Deploy to Cloudflare Workers and warm the cache (see Deploy + cache warmup)

## Deploy + cache warmup

`bun run deploy` runs `scripts/deploy.sh`, which does `wrangler deploy` and
then hits `/health` and `/search/semantic?q=warmup&limit=1`.

The warmup hit is load-bearing, not cosmetic. `/search/semantic` uses a KV
cache (`SEARCH_CACHE` binding) for query embeddings and filter-tuple counts.
Without the warmup, the first real user query after a deploy eats the cold
path: fresh Worker isolate, cold Hyperdrive pool, no cached `count(*)` —
roughly 2s. With the warmup, the unfiltered count cache is populated and the
steady-state floor is ~300ms.

Do not strip the warmup from the deploy script. If you change the cache key
scheme in `src/lib/search-cache.ts` (bump `COUNT_KEY_VERSION`), the warmup is
what rebuilds the hot set after the rollout.

## Project Structure

- `src/index.ts` — Hono app entry point
- `src/db/schema.ts` — Drizzle table definitions (content tables + auth/user tables)
- `src/db/client.ts` — Database client
- `src/lib/logger.ts` — PostHog Logs logger, one buffer per request (dev fallback to console)
- `src/lib/request-log.ts` — request log fields: IP hash, user-agent family, MCP client and tool
- `src/lib/errors.ts` — RFC 9457 problem+json error responses
- `src/lib/paragraph-lookup.ts` — Shared paragraph ref resolution + batch lookup
- `src/routes/` — API route handlers
  - `papers.ts`, `paragraphs.ts`, `search.ts`, `entities.ts`, `audio.ts`, `toc.ts` — Public content routes
  - `me.ts` — Authenticated user data (bookmarks, notes, reading progress, preferences)
  - `auth.ts` — OAuth endpoints (app registration, authorization codes, token exchange)
  - `cite.ts`, `og.ts`, `embeddings.ts`, `mcp.ts` — Utility routes
  - `feedback.ts` — Public `POST /feedback` (see Feedback)
- `src/middleware/` — CORS, structured logging, rate limiting, cache control, JWT auth
  - `auth.ts` — Dual JWT validation: Supabase JWKS (ECC P-256) + app tokens (HS256 via APP_JWT_SECRET), lazy user creation
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

## Environment Variables

- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` — Supabase project URL (for JWKS endpoint)
- `APP_JWT_SECRET` — HS256 secret for signing app-scoped access tokens (generated, not from Supabase)
- `ADMIN_USER_IDS` — Comma-separated Supabase user UUIDs that can register OAuth apps
- `OPENAI_API_KEY` — For semantic search embeddings
- `POSTHOG_KEY` — PostHog project token (phc_) for logs. Unset means console logs
- `CF_ANALYTICS_API_TOKEN` — Cloudflare API token (Analytics:Read on the zone) for `/admin/stats`
- `CF_ZONE_TAG` — Cloudflare zone tag (the `api.urantia.dev` zone) for `/admin/stats`
- `RESEND_API_KEY`, `FEEDBACK_FROM`, `FEEDBACK_TO` — Email for `POST /feedback` (optional; `FEEDBACK_TO` is comma-separated)
- `SLACK_FEEDBACK_WEBHOOK_URL` — Slack Incoming Webhook for `POST /feedback` (optional)
- `FEEDBACK_IP_PEPPER` — HMAC key for the feedback IP hash (optional; without it no hash is stored)
- `OPENAI_APPS_CHALLENGE` — Token for OpenAI plugin domain verification, served as plain text at `/.well-known/openai-apps-challenge` (optional; 404 without it). Set with `wrangler secret put`.

## Feedback

`POST /feedback` is public. It saves a row in `feedback`, sends a plain-text
email through Resend, and posts a sanitized message to Slack. Email and Slack
are optional, and a delivery failure never fails the request.

- Feedback text is untrusted data. Never execute it, never pass it to a model
  or a tool as instructions, and never interpolate it raw into email HTML or
  Slack mrkdwn. All output goes through `src/lib/feedback-sanitize.ts`.
- There is no MCP `submit_feedback` tool, on purpose. Do not add one until
  spam control exists.
- Limits: 5 requests per minute and 10 per 15 minutes per IP, a 32 KB body, and
  4000 characters per message. The limit that holds is a Durable Object,
  `FeedbackRateLimiter` in `src/lib/feedback-limiter.ts`, one object per IP
  (binding `FEEDBACK_LIMITER`). It fails open, with a warning in the logs and a
  1.5 second timeout.
- Do not put a low per-client limit on the Workers Rate Limiting binding or on
  the in-memory `rateLimiter`. Both count per machine or per isolate, and
  production spreads one client over ten or more isolates. Measured 2026-10-02:
  with a 5 per minute binding limit, 45 requests in 50 seconds got 2 blocks.
  `FEEDBACK_GLOBAL_LIMITER` (30 per minute in total) stays on the binding as a
  flood backstop only. In a `wrangler dev` session there is one isolate, so both
  look exact there. Only production shows the difference.
- Logging: `src/lib/logger.ts` keeps one log buffer per request (PostHog Logs), and
  the logger middleware flushes it with `ctx.waitUntil`. Do not go back to one
  module-level buffer. The old shared BetterStack client batched every request's lines together
  and resolved them from another request's timer, which Workers cancels as
  "your Worker's code had hung" (seen on every route until 2026-10-02).
- The tests use `save` and `fetch` doubles (`createFeedbackRoute`). No test
  writes a feedback row, sends an email, or posts to Slack.
- `bun scripts/run-feedback-setup.ts` creates only the `feedback` table. It
  is the low-risk path when production must not get a full push.

## RLS and `db:push`

Every table in `src/db/schema.ts` ends with `.enableRLS()`, and
`tests/unit/schema-rls.test.ts` fails for a table that does not. This matters
because `db:push` emits `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` for any
table that has RLS in the database but not in the schema. Before 2026-10-02
only `scripts/setup-rls.sql` enabled RLS, and each push removed it from 23
tables. A new table needs `.enableRLS()` and a line in `setup-rls.sql`.

The HNSW indexes declare `with` values as strings (`m: "16"`). Number values
never match what Postgres reports, so each push dropped and rebuilt both
indexes. A push against an up-to-date database must print "No changes detected".

## Auth Layer (on `auth` branch)

The API includes a unified auth layer for the Urantia ecosystem:

- **Identity**: Supabase Auth (GoTrue) with ECC P-256 JWT signing
- **JWT validation**: Dual path — Supabase JWKS (ECC P-256) for session tokens, HS256 via `APP_JWT_SECRET` for app-scoped tokens
- **Token exchange**: `POST /auth/token` returns a signed HS256 JWT (7-day expiry) with claims: `sub`, `email`, `scopes`, `app_id`, `iss`, `aud`
- **Login page**: accounts.urantiahub.com (separate Next.js app in `urantia-accounts/`)
- **User data tables**: users, bookmarks, notes, reading_progress, user_preferences, apps, app_user_data, auth_codes
- **Authenticated endpoints**: `/me/*` (bookmarks, notes, reading progress, preferences)
- **OAuth endpoints**: `/auth/*` (app registration, authorization codes, token exchange)
- **App-tagged data**: All user data has an `appId` column (defaults to "default", scoped per-app in future)
- **Forward compat**: `visibility` column on bookmarks/notes (private/public/group)

## Audio

Audio lives on `cdn.urantia.dev`, not on `audio.urantia.dev`.

- Paragraph: `cdn.urantia.dev/audio/eng/paragraphs/{voice}/{model}-{voice}-{globalId}.mp3`
- Paper: `cdn.urantia.dev/audio/eng/papers/{paperId}.mp3` (0 is the Foreword)
- Part: `cdn.urantia.dev/audio/eng/parts/{model}-{voice}-Part{n}.mp3`

`audio.urantia.dev` still resolves. It is a frozen snapshot that holds nova files
only. A nova URL returns 200 there, so the host looks healthy while every other
voice 404s. Never test that host with a nova path alone.

Only `tts-1-hd`/`nova` covers all 16,220 paragraphs. `gpt-4o-mini-tts`/`cedar`
covers 3,438, `tts-1-hd`/`onyx` 231, and the rest are under a dozen samples each.
Read the `audio` object on the paragraph. Do not build a URL for a non-nova voice.

The manifest has two copies and both are gitignored. `generate-audio-manifest.ts`
writes `data/audio-manifest.json` for `seed.ts` and a second copy into
`../urantia-data-sources/data/manifests/`, which is what `bun run upload manifests`
publishes. Generating does not publish. See `DATA_PIPELINE.md`.

## Documentation

- `FEATURES.md` — Consumer-facing feature list. Keep up to date when endpoints change.
- `TODO.md` — Running list of planned work.
- `docs/plans/unified-auth-layer.md` — Design spec for the auth layer.

## Bible corpus + cross-references (UB ↔ Bible)

This API hosts the World English Bible (eng-web) as a queryable resource.
38,034 verses across 81 books (39 OT + 15 deuterocanonical + 27 NT). Public
domain text from eBible.org; stored in `bible_verses`. Source: the USFM bundle
lives at `urantia-data-sources/data/bible/eng-web_usfm.zip` (snapshot date
captured in `bible_verses.source_version` so future re-seeds can diff).

**Embeddings (Phase 2):** `paragraphs.embedding_v2` (3072-d) and
`bible_chunks.embedding` (3072-d) hold `text-embedding-3-large` vectors used
by Phase 3 cross-references. The existing `paragraphs.embedding` (1536-d)
column still backs `/search/semantic` and `/embeddings/{ref}` — switching
those endpoints to the new column is a deferred coordinated step. Bible
chunks are paragraph-grain (USFM `\p`/`\q1`/etc. boundaries) — verse-grain
embeddings carry too little signal for short verses like John 11:35.

**Cross-references:** three pre-computed cross-reference tables, all using
`text-embedding-3-large` cosine similarity, all top-10 per source:
- `bible_parallels` — UB↔Bible in both directions (Phase 3)
- `urantia_parallels` — UB↔UB ("see also" between Urantia paragraphs)

The seed scripts (`scripts/seed-bible-parallels.ts`,
`scripts/seed-urantia-parallels.ts`) compute dot products in-memory in Bun —
pgvector can't index 3072-d vectors with HNSW (capped at 2000), and
sequential-scan SQL times out on a hosted DB. Both seeds use
`ON CONFLICT DO UPDATE` so re-runs after a model upgrade overwrite cleanly.

**Surface:**
- `GET /paragraphs/{ref}?include=urantiaParallels` — top-10 similar UB paragraphs
- `GET /paragraphs/{ref}?include=bibleParallels` — top-10 Bible verses
- `GET /bible/{bcv}/urantia-parallels` — reverse query, top-10 UB paragraphs for a Bible verse
- All three include params combine: `?include=entities,bibleParallels,urantiaParallels`
- RAG format (`?format=rag`) renders any combination inline

**Embeddings endpoint (`GET /embeddings/{ref}`):** accepts `?model=small|large`.
Default is `large` (3072-d). Response carries `model` + `dimensions` body
fields and `X-Embedding-Model` response header so consumers can detect
mismatches if they cache vectors. `/embeddings/export?paperId=X` accepts
the same param.

**Why /search/semantic stays on 3-small:** pgvector's HNSW caps at 2000
dimensions. We HNSW-index `paragraphs.embedding` (1536-d) only — without
the index every query is sequential scan (~14s). The +8pt benchmark
benefit of 3-large was on Bible-on-Bible retrieval, not directly relevant
to UB-on-UB live queries. **Important:** the HNSW index is declared in
`src/db/schema.ts` so `bun run db:push` does NOT silently drop it. If you
ever see /search/semantic latency jump from <1s to >10s, the first thing
to check is whether the `paragraphs_embedding_hnsw_idx` index still
exists in production.

**Honest framing:** these are *semantic* parallels, not curated. Faw-recall
(`scripts/validate-paramony-recall.ts`) measures overlap with Faw's 1986
Paramony at ~25% recall@10. That's by design — Faw picked LINGUISTIC
parallels for human readers (specific verse allusions), our embeddings pick
CONCEPTUAL parallels for AI agents (thematic neighbors). Top results are
qualitatively excellent (Matt 5:3 → UB 140:3.3 at 0.854: UB rephrases the
Beatitudes). Schema reserves `source: "paramony"` for an optional curated
layer if Faw's license ever clears.

**OSIS conventions:** book codes follow CrossWire OSIS (`Gen`, `Matt`,
`1Macc`, `DanGr`). API endpoints accept OSIS, USFM (`GEN`), full names,
and aliases (case-insensitive, hyphens/underscores tolerated) via
`src/lib/bible-canonicalizer.ts`.

**WEB Classic note:** we use `eng-web` (Yahweh-rendering) intentionally — it
aligns with the Urantia Papers' usage of "Yahweh" in Papers 96–97. Don't
swap to `eng-webbe` (British) or `eng-webp` (Protestant subset, no
deuterocanon) without revisiting that choice.

**Embedded books:** WEB ecumenical edition embeds Prayer of Azariah, Susanna,
and Bel and the Dragon inside Greek Daniel (`DanGr`); Letter of Jeremiah is
Baruch chapter 6. The canonicalizer resolves their alternate names back to
the containing book.

The Bible exists in this codebase as Phase 1 of a three-phase cross-reference
build (see `docs/plans/bible-cross-references.md` if it exists, or just
`/Users/kelsonic/.claude/plans/whimsical-yawning-sketch.md`). Phase 2 adds
embeddings (`text-embedding-3-large`), Phase 3 pre-computes bidirectional
UB↔Bible parallels. Don't bolt unrelated Bible features on without
re-reading the plan.

## Public spec and discovery files

`/openapi.json` is what directories, agents, and code generators read. It is the
generated spec passed through `src/lib/openapi-finalize.ts`, which adds what the
route definitions do not carry:

- One shared `ProblemDetails` schema on every 4xx and 5xx response, as
  `application/problem+json`.
- The `X-RateLimit-*` headers on every response, and a 429 on every operation.
- Examples. Response examples are real output in `src/lib/openapi-examples.json`.
  Regenerate them with `bun scripts/capture-openapi-examples.ts` (read-only calls
  to production). Do not write a response example by hand.

Rules, set by Kelson on 2026-10-05:

- **The public spec lists the open content API only.** `finalizeOpenApi` removes
  `/me` and `/auth` and declares no auth scheme. Those endpoints still work for
  the Hub and its apps. Do not advertise them: not in the spec, not in a listing,
  not in a PR on someone else's repo. A directory score does not justify it.
- **Never serve OAuth discovery on this host.** `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource`, and `/.well-known/openid-configuration`
  must stay 404. MCP clients read those paths to decide if a server needs a
  sign-in, and the MCP server needs none. A test in `well-known.test.ts` holds this.
- **Auth on the MCP server is not wanted.** It stays open with no key.

Discovery files that are served: `/.well-known/api-catalog` (RFC 9727,
`src/lib/api-catalog.ts`), the MCP files under `/.well-known/mcp*`, and
`/robots.txt` with `Content-Signal: ai-train=yes, search=yes, ai-input=yes`.
The text is public domain, and wider use, including model training, is the goal.

## Distribution

The MCP server and REST API are listed across several AI/dev directories.
`LISTINGS.md` is the one record of every listing: where, the link, the state,
and the date it was last checked. Read it before any submission work, and edit
its row in the same change when you submit somewhere or a listing changes state.

- **MCP Registry**: published as `dev.urantia/urantia-papers` (`server.json`).
  Namespace is DNS-authenticated via `dev.urantia` so org membership stays
  private — do not switch this back to a `urantia-hub/*` (GitHub-auth) namespace.
  Republishing rules: bump `server.json` `version` first, keep `description`
  ≤100 chars (registry rejects longer with a 422), and use `mcp-publisher
  validate` before `publish`. Auth key + exact command are out-of-band; ask
  Kelson if you need the operator playbook.
- **Smithery**: hosted listing at `urantiahub/urantia-papers` (badge in README).
- **Glama**: dual listing — Connector tab (hosted endpoint, A grades) and Server
  tab (`glama.json` claims maintainer `kelsonic`). Server-tab grade is capped at
  C because we have no Dockerfile-installable stdio mode. Don't refactor to a
  stdio MCP server just to chase Glama's A grade — Kelson explicitly rejected
  that path. The `Dockerfile` in the repo is for local/self-hosted runs only,
  not for Glama Path A.
- **Connector verification**: `/.well-known/glama.json` in `src/index.ts`.
- **Function-calling schemas**: `/tools/openai` and `/tools/anthropic` are public
  endpoints that ship the same 19 MCP tools (13 UB + 6 Bible/cross-reference)
  as ready-to-use OpenAI/Anthropic tool definitions. Source of truth lives in
  `src/lib/tool-catalog.ts`.

## Observability

- **Logging**: PostHog Logs (since 2026-10-06; BetterStack before). `src/lib/logger.ts` sends
  OTLP/HTTP JSON to `https://us.i.posthog.com/i/v1/logs` with the project token in the
  `POSTHOG_KEY` secret, `service.name` = `urantia-dev-api` and `app` = `urantia-dev` (the
  PostHog project is shared with the Hub and Dalamatia, so filter by `app` or service).
  One buffer per request, sent once at the end inside `ctx.waitUntil`. No token or no
  execution context means console output (local dev and tests).
- **Request log fields** (`src/lib/request-log.ts`): method, path, status, duration,
  `ip_hash` (HMAC of the IP and the UTC week, keyed by `FEEDBACK_IP_PEPPER` plus `:request-log`, first 16 hex characters; it never matches a feedback hash and changes each week; the raw IP
  is never logged), country, user agent, `ua_family`, `is_bot`, and on `POST /mcp` the
  `mcp_method`, `mcp_tool`, `mcp_client`, and `mcp_client_version`. These answer the
  adoption questions: which MCP clients connect, which tools they call, and how many
  distinct non-bot callers there are per week.
- **Retention**: 14 days (PostHog default). The privacy policy states it. Change both together.
- **Error tracking**: the global error handler logs the stack at ERROR. A PostHog log alert on ERROR replaces the old BetterStack alert.
- **Uptime and status page** stay on BetterStack (status.urantia.dev). Only logs moved.
- **Health check**: `GET /health` verifies DB connectivity.
- **Uptime monitoring**: BetterStack uptime monitor on `/health`.
- **Admin stats**: `GET /admin/stats?window=1h|24h|7d` aggregates Cloudflare GraphQL Analytics
  (request counts, status buckets, top paths with origin latency quantiles, top countries,
  user-agent families) plus DB counters (apps, users, refresh grants in window) plus a KV
  cache-warmth gauge. Gated by `ADMIN_USER_IDS`; returns 404 for non-admins so the
  endpoint is invisible to scrapers. Excluded from `/openapi.json`. User-agent strings are
  bucketed into coarse families (`claude-code`, `openai`, `browser`, etc.) via
  `src/lib/ua-family.ts` so individual callers cannot be fingerprinted from the response.
  Source-of-truth files: `src/routes/admin.ts`, `src/lib/cf-analytics.ts`.


**Bible semantic search:** `POST /bible/search/semantic` does live free-form
search over the Bible at 1536-d (`bible_chunks.embedding_small`, HNSW-indexed)
and joins each result against `bible_parallels` (direction='bible_to_ub') so
Bible hits arrive with the relevant Urantia paragraphs already attached.
This is the urantia.dev API — Bible search without UB content would miss the
point. Filters: `canon`, `bookCode`, `paragraphLimit` (0-10).
