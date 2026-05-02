# TODO

## Next up

- [x] **Structured logging** — BetterStack via `@logtail/edge`. Structured JSON logs with request metadata, search query metrics, and error tracking with stack traces. Health check at `GET /health`.

- [x] **Tests** — 118 integration + unit tests across all endpoints, middleware, and `detectRefFormat`. Run with `bun test`. Semantic search tests conditional on `OPENAI_API_KEY`.

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

- [ ] **Hybrid search (RRF)** — (low priority) Combine vector + full-text search via Reciprocal Rank Fusion for ~62% → ~84% retrieval precision. Parallel pgvector + tsvector queries fused with k=60. Semantic weight 0.6-0.7 since users often ask about concepts.

## API Polish (High Priority)

- [x] **RFC 9457 error responses** — All errors now return `application/problem+json` with `type`, `title`, `status`, `detail` fields per RFC 9457. Helper at `src/lib/errors.ts`. Shared `createApp()` factory in `src/lib/app.ts` with `defaultHook` ensures Zod validation errors also return RFC 9457 shape. Updated across all routes, middleware, and global error handler.

- [x] **Rate limit headers** — `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` on every response. Rate limit bumped to 200/min.

- [x] **Citation formatter** — `GET /cite?ref=196:2.1&style=apa` returns formatted citations in APA, MLA, Chicago, BibTeX. Accepts all three ref formats.

- [x] **Dynamic OG images** — `GET /og/{ref}` renders 1200×630 social cards via `workers-og` with theme variants (default/warm/purple/minimal). Cached permanently via `Cache-Control: immutable`.

- [x] **RAG-optimized format** — `?format=rag` on `/paragraphs/:ref` and `/paragraphs/random` returns plaintext + citation + metadata + prev/next navigation + token count + entity names. Helper at `src/lib/rag.ts`.

- [x] **Embeddings export** — `GET /embeddings/{ref}` for single 1536-dim vector, `GET /embeddings/export?format=jsonl&paperId=` for bulk download with paperId/partId filters.

## API Polish (Medium Priority)

- [x] **Navigation metadata** — `GET /paragraphs/{ref}` and `GET /paragraphs/random` now return a `navigation` envelope with `prev`/`next` refs (within the same paper, ordered by sortId; null at boundaries). Helper extracted to `src/lib/paragraph-lookup.ts` and reused by RAG format.

- [x] **Function calling schemas** — `GET /tools/openai` and `GET /tools/anthropic` return ready-to-use tool definitions for the OpenAI Chat Completions and Anthropic Messages APIs. Source of truth lives in `src/lib/tool-catalog.ts`.

- [x] **MCP server enhancements** — Added Resources (`urantia://paper/{id}` rendered as markdown, `urantia://entity/{id}` with description + paragraph references) and Prompts (`study_assistant` with optional topic, `comparative_theology` taking topic + tradition) on top of the existing 13 tools.

- [ ] **API directory listings** — Submit to ~~public-api-lists (GitHub)~~ ✅ merged, Postman public workspace, RapidAPI, faith.tools, APIs.guru. Free distribution to millions of developers.

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
