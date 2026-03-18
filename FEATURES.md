# Urantia.dev — Features

> **Free, open API for The Urantia Book.** No authentication required. MIT-licensed.
>
> Base URL: `https://api.urantia.dev`

---

## Content

- **197 papers** across 4 parts, 1,626 sections, 14,500+ paragraphs
- **4,400+ entities** — beings, places, orders, races, religions, concepts (sourced from Urantiapedia)
- **Three paragraph reference formats** — all auto-detected (`2:0.1`, `2.0.1`, `1:2.0.1`)
- **Entity enrichment** — attach typed entity mentions to any paragraph via `?include=entities`

## Search

- **Full-text search** — AND, OR, and phrase modes with headline highlighting
- **Semantic search** — vector similarity via OpenAI `text-embedding-3-small` (1536-dim) embeddings
- **Filterable** by paper or part

## Audio

- **Text-to-speech narration** for every paragraph
- **Multiple voices** — 6 voices across 2 TTS models (tts-1-hd, tts-1)
- **Hosted on `audio.urantia.dev`** — direct MP3 URLs in every paragraph response

## AI & Developer Tools

- **MCP Server** at `api.urantia.dev/mcp` — 13 tools for Claude, Cursor, Windsurf, and other AI agents
- **RAG-optimized format** — `?format=rag` returns streamlined responses with metadata, navigation, and token counts
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
