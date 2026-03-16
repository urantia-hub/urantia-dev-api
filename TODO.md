# TODO

## Next up

- [x] **Structured logging** — BetterStack via `@logtail/edge`. Structured JSON logs with request metadata, search query metrics, and error tracking with stack traces. Health check at `GET /health`.

- [x] **Tests** — 70 integration + unit tests across all endpoints, middleware, and `detectRefFormat`. Run with `bun test`. Semantic search tests conditional on `OPENAI_API_KEY`.

- [x] **Semantic search** — `POST /search/semantic` endpoint with pgvector cosine similarity. Embeddings generated via `text-embedding-3-small`, stored in DB + `data/embeddings.json`. HNSW index for fast vector search.

## Next up

- [ ] **Entity enrichment** — Typed entity mentions (being, place, order, race, concept) with character-level spans on every paragraph, plus theme tags for discovery. ~5,000 entities seeded from Urantiapedia + LLM extraction pass. New endpoints: `/entities`, `/entities/{id}`, `/entities/{id}/paragraphs`, `/themes`, `/themes/{id}/paragraphs`. Estimated cost: ~$15 in LLM API fees. See `ENTITY_ENRICHMENT_GAMEPLAN.md` for full plan and `EXTERNAL_SOURCES.md` for data source research.
  - [ ] Part A: Build enriched data (parse Urantiapedia, LLM entity extraction, theme classification, alias resolution, validation)
  - [ ] Part B: DB schema + API endpoints (entities/themes tables, JSONB columns on paragraphs, new routes)
  - [ ] Part C: Typed relation inference + graph traversal (deferred)

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

- [ ] **Hyperdrive** — Cloudflare's edge connection pooler. Would replace per-request DB connections with pooled ones. Requires Workers Paid plan ($5/mo). Not needed yet but worth it at scale.

- [ ] **Staging environment** — Add `[env.staging]` to `wrangler.toml` with a separate `DATABASE_URL` when ready.

## Content & Media

- [ ] **ElevenLabs TTS audio** — Multi-voice narration of the entire Urantia Book using ElevenLabs Eleven v3. ~14,500 paragraphs with dynamic voice assignment based on paper author and dialogue speaker. Separate Python project. See `TTS_GAMEPLAN.md` for full plan. Estimated cost: $1,000-$2,000. Phases: data extraction → voice design & pronunciation dictionary → batch generation → QA & upload.

- [ ] **Multi-language support** — Add `?lang=` query parameter to all endpoints with AI-generated translations. Top 5 languages: Spanish, French, Portuguese, German, Korean. Part A: API schema/route changes (backwards compatible, defaults to English). Part B: Translation generation script using Claude Sonnet (~$150 for all 5 languages). See `MULTI_LANGUAGE_GAMEPLAN.md` for full plan.
