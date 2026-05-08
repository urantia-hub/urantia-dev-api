# Urantia.dev — Features

> **Free, open API for The Urantia Book.** No authentication required. MIT-licensed.
>
> Base URL: `https://api.urantia.dev`

---

## Content

- **197 papers** across 4 parts, 1,626 sections, 14,500+ paragraphs
- **4,400+ entities** — beings, places, orders, races, religions, concepts (sourced from Urantiapedia)
- **38,034 Bible verses** — entire World English Bible (eng-web), public domain, 81 books (39 OT + 15 deuterocanonical + 27 NT)
- **Three paragraph reference formats** — all auto-detected (`2:0.1`, `2.0.1`, `1:2.0.1`)
- **Entity enrichment** — attach typed entity mentions to any paragraph via `?include=entities`
- **Bible API** — `/bible/books`, `/bible/{bookCode}`, `/bible/{bookCode}/{chapter}`, `/bible/{bookCode}/{chapter}/{verse}` with OSIS book codes and forgiving alias resolution

## Search

- **Full-text search** — AND, OR, and phrase modes with headline highlighting
- **Semantic search** — vector similarity via OpenAI `text-embedding-3-small` (1536-dim) embeddings
- **Filterable** by paper or part

## Audio

- **Text-to-speech narration** for every paragraph
- **Multiple voices** — 6 voices across 2 TTS models (tts-1-hd, tts-1)
- **Hosted on `audio.urantia.dev`** — direct MP3 URLs in every paragraph response

## AI & Developer Tools

- **MCP Server** at `api.urantia.dev/mcp` — 19 tools (Urantia Papers + Bible + cross-references), 2 resource templates (`urantia://paper/{id}`, `urantia://entity/{id}`), and 2 prompt templates (`study_assistant`, `comparative_theology`) for Claude, Cursor, Windsurf, and other AI agents
- **Bible + cross-reference tools** — `bible.books`, `bible.book`, `bible.chapter`, `bible.verse`, `bible.verse.urantia_parallels` (top-10 UB paragraphs nearest a Bible verse), and `bible.search.semantic` (Bible search that returns matching UB paragraphs alongside each hit)
- **UB ↔ Bible parallels on existing tools** — pass `include_bible_parallels` and/or `include_urantia_parallels` to `paragraphs.get`, `paragraphs.random`, `search.fulltext`, and `search.semantic` to get the top-10 semantic neighbors attached to each result
- **Function-calling schemas** — `/tools/openai` and `/tools/anthropic` return drop-in tool definitions for the OpenAI and Anthropic SDKs
- **RAG-optimized format** — `?format=rag` returns streamlined responses with metadata, navigation, and token counts
- **Navigation metadata** — every single-paragraph response includes prev/next refs within the paper for reading-flow UIs
- **Context windows** — fetch a paragraph with N surrounding paragraphs for richer AI context
- **Embedding export** — bulk download vectors per paper (JSONL/JSON)
- **OpenAPI 3.1 spec** — generate typed clients in any language from `/openapi.json`

## Utilities

- **Citation formatting** — APA, MLA, Chicago, BibTeX
- **Dynamic OG images** — social-ready 1200×630 PNGs with theme options
- **Random paragraph** — daily quotes, serendipitous discovery
- **Table of contents** — full hierarchical structure (parts → papers)

## Infrastructure

- **Cloudflare Workers** — global edge deployment
- **CDN caching** — 24h for static content, 1h for search, configurable
- **Rate limiting** — 200 req/min per IP
- **RFC 9457 error responses** — standard Problem Details format
- **Interactive docs** — Swagger UI at `/docs`
- **Status page** — `status.urantia.dev`

## Resources

- **API docs**: [urantia.dev](https://urantia.dev)
- **Interactive demo**: [demo.urantia.dev](https://demo.urantia.dev)
- **Reading platform**: [urantiahub.com](https://urantiahub.com)
- **OpenAPI spec**: [api.urantia.dev/openapi.json](https://api.urantia.dev/openapi.json)
- **MCP Server**: [api.urantia.dev/mcp](https://api.urantia.dev/mcp)

---

## Roadmap

- Translations (Spanish, French, Portuguese, German, Korean)
- ElevenLabs premium audio narration
- Entity relationship graph visualization
- Community project directory
