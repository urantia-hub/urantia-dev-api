# TODO

## Next up

- [x] **Structured logging** — BetterStack via `@logtail/edge`. Structured JSON logs with request metadata, search query metrics, and error tracking with stack traces. Health check at `GET /health`.

- [x] **Tests** — 70 integration + unit tests across all endpoints, middleware, and `detectRefFormat`. Run with `bun test`. Semantic search tests conditional on `OPENAI_API_KEY`.

- [x] **Semantic search** — `POST /search/semantic` endpoint with pgvector cosine similarity. Embeddings generated via `text-embedding-3-small`, stored in DB + `data/embeddings.json`. HNSW index for fast vector search.

## Completed

- [x] **Entity enrichment (Parts A & B)** — 4,456 entities (being, place, order, race, religion, concept) seeded from Urantiapedia with AI-refined descriptions via Claude Sonnet. DB schema: `entities`, `entityTranslations`, `paragraphEntities` tables. Live endpoints: `GET /entities`, `GET /entities/{id}`, `GET /entities/{id}/paragraphs`. Paragraph-entity junction table maps ~4,700 citations.

## Next up

- [ ] **Entity enrichment Part C** — Typed relation inference + graph traversal. Character-level spans for UI highlighting. Theme/concept classification tags. Endpoints: `/entities/{id}/relations`, `/themes`, `/themes/{id}/paragraphs`. See `ENTITY_ENRICHMENT_GAMEPLAN.md`.

- [x] **Semantic search timing logs** — Per-step timing on `POST /search/semantic` (embedding, DB queries, entity enrichment). Count + vector search parallelized via `Promise.all`. Logs to BetterStack.

## Knowledge System & Cross-References (Build #2)

Infrastructure layer: turn the Urantia Papers from a book into a queryable knowledge graph.

- [ ] **Cross-reference generation** — Auto-generate and manually curate cross-references linking related passages across Papers. When a reader encounters "Thought Adjusters" in Paper 107, surface connections to Papers 1, 2, 5, 108-112, etc. Pipeline: embedding similarity + keyword co-occurrence + LLM validation. New endpoints: `GET /paragraphs/{ref}/cross-references`, `GET /cross-references?topic=`.

- [ ] **Topic & concept pages** — 200+ topic aggregation pages (Morontia, Paradise, The Supreme Being, Faith, Prayer, etc.) collecting every relevant passage. New endpoints: `GET /topics`, `GET /topics/{slug}`, `GET /topics/{slug}/paragraphs`. Data sources: Fellowship glossary (1,549 terms / 90,948 refs), Urantiapedia, LLM classification.

- [ ] **Knowledge graph traversal** — Extend entity enrichment (Part C) with typed relations between entities, enabling graph queries like "all beings mentioned in relation to Salvington" or "concept lineage of The Supreme." `GET /entities/{id}/relations`, `GET /graph/traverse?from=&depth=`.

## Reading Plans API (Build #1)

Backend for guided reading plans — the fastest path to new reader retention.

- [ ] **Reading plan schema & endpoints** — Plans table (title, description, duration_days, difficulty, theme), plan_days table (day number, paragraph refs, commentary). Endpoints: `GET /plans`, `GET /plans/{id}`, `GET /plans/{id}/days/{day}`. Support for 3-7 day topical plans and 21-30 day thematic journeys.

- [ ] **"Where Should I Start?" quiz endpoint** — `POST /plans/recommend` accepting reader background/interests, returning ranked plan suggestions. Simple rule-based initially, LLM-powered later.

- [ ] **Passage of the Day endpoint** — `GET /daily-passage` returning a curated or algorithmically-selected passage with shareable metadata (image card dimensions, social text). Supports the daily engagement loop.

## Study Group Toolkit API (Build #3)

API support for the 463+ registered study groups operating with zero purpose-built tools.

- [ ] **Source sheets** — Curated collections of related passages with facilitator commentary. Endpoints: `GET /source-sheets`, `POST /source-sheets`, `GET /source-sheets/{id}`. Inspired by Sefaria's most popular feature.

- [ ] **AI discussion question generation** — `POST /study/questions` accepting paragraph refs, returning AI-generated discussion questions for study group prep. Include difficulty levels and question types (comprehension, reflection, application).

## Developer Ecosystem (Build #4)

Turn urantia.dev from an API into a platform that enables third-party builders.

- [ ] **OpenAPI spec sync** — The Mintlify docs reference a static `api-reference/openapi.json`. Add a script or CI step to fetch the latest spec from production and update it.

- [ ] **Developer portal content** — Getting-started tutorials, code examples in JS/TS + Python + Swift, and a project showcase page on urantia.dev docs. Lower the barrier for the <10 GitHub repos in this ecosystem.

- [ ] **Embeddable linker/widget** — JS snippet any Urantia website can embed to auto-link citations (e.g., "Paper 1:2.3") back to UrantiaHub with tooltip previews. Inspired by Sefaria's Linker. Endpoint: `GET /embed/paragraph/{ref}` returning HTML/JSON for rendering.

- [ ] **SDKs** — Published packages for JavaScript/TypeScript (`@urantia-dev/sdk`), Python (`urantia-dev`), and eventually Swift/Kotlin. Auto-generated from OpenAPI spec.

- [ ] **Logo** — Create a combined SVG with icon + "Urantia.dev" wordmark for the Mintlify docs header.

## Infrastructure

- [x] **Hyperdrive** — Cloudflare Hyperdrive connection pooler enabled. Workers Paid plan ($5/mo). Eliminates cold DB connection spikes (6-9s → consistent ~400ms). Binding: `HYPERDRIVE` in `wrangler.toml`, `getDb(c.env?.HYPERDRIVE)` in all REST routes.

- [ ] **Staging environment** — Add `[env.staging]` to `wrangler.toml` with a separate `DATABASE_URL` when ready.

## Content & Media

- [ ] **ElevenLabs TTS audio** — Multi-voice narration of the entire Urantia Book using ElevenLabs Eleven v3. ~14,500 paragraphs with dynamic voice assignment based on paper author and dialogue speaker. Separate Python project. See `TTS_GAMEPLAN.md` for full plan. Estimated cost: $1,000-$2,000. Phases: data extraction → voice design & pronunciation dictionary → batch generation → QA & upload.

- [ ] **Multi-language support** — Add `?lang=` query parameter to all endpoints with AI-generated translations. Top 5 languages: Spanish, French, Portuguese, German, Korean. Part A: API schema/route changes (backwards compatible, defaults to English). Part B: Translation generation script using Claude Sonnet (~$150 for all 5 languages). See `MULTI_LANGUAGE_GAMEPLAN.md` for full plan.
