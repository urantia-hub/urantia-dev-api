# Urantia.dev — Features

> **Free, open API for The Urantia Papers.** No authentication required. MIT-licensed.
>
> Base URL: `https://api.urantia.dev`

---

## Content

- **197 papers** across 4 parts, 1,626 sections, 14,500+ paragraphs
- **4,400+ entities** — beings, places, orders, races, religions, concepts (sourced from Urantiapedia)
- **38,034 Bible verses** — entire World English Bible (eng-web), public domain, 81 books (39 OT + 15 deuterocanonical + 27 NT)
- **Three paragraph reference formats** — all auto-detected (`2:0.1`, `2.0.1`, `1:2.0.1`)
- **Entity enrichment** — attach typed entity mentions to any paragraph via `?include=entities`
- **Works API** — `/works`, `/works/search`, `/works/search/semantic`, `/works/{work}/{ref}`, `/works/{work}/{ref}/urantia-parallels`: the Bible and the other works in one result shape (work, reference, text, link, nearest Urantia paragraphs)
- **Works list** — the Bible (World English Bible) and 21 public domain texts, each with its tradition, kind (scripture, classic, or recorded), edition, and a one-sentence summary: Diogenes Laertius Book 6 and Epictetus 3.22 (Cynic), the Dhammapada (Buddhist), the Bhagavad Gita, the Rig Veda, and three Upanishads (Hindu), the Shinto oracles and the Kojiki (Japanese, Shinto), the Tao Te Ching and Chuang Tzu (Taoist), the Analects and the Shu King (Confucian), the Koran (Muslim), the Japji (Sikh), the Book of Mormon (Latter Day Saint), the Book of the Dead (Ancient Egyptian), Hesiod and the Homeric Hymns (Ancient Greek), the Poetic and Prose Eddas (Norse), and Aztec hymns (Aztec, Nahua)
- **Bible API** — `/bible/books`, `/bible/{bookCode}`, `/bible/{bookCode}/{chapter}`, `/bible/{bookCode}/{chapter}/{verse}` with OSIS book codes and forgiving alias resolution

## Search

- **Full-text search** — `auto` (default): a reference such as `68:6.3` gives that paragraph, then the exact phrase, all words, typo fixes (`meta.didYouMean`), and most words, each result marked with `match`. Also AND, OR, and phrase modes, with headline highlighting
- **Semantic search** — vector similarity via OpenAI `text-embedding-3-small` (1536-dim) embeddings
- **Filterable** by paper or part

## Audio

- **Text-to-speech narration** for every paragraph
- **Multiple voices** — 7 voices across 3 TTS models (tts-1-hd, gpt-4o-mini-tts, tts-1)
- **Hosted on `cdn.urantia.dev/audio/eng/`** — direct MP3 URLs in every paragraph response
- **One file for a whole paper** — `GET /papers/{id}` has `paper.audio`: the file of the paper and the start of each title, paragraph, and sentence in it (`scripts/generate-paper-audio-timing.ts`)

## AI & Developer Tools

- **MCP Server** at `api.urantia.dev/mcp` — 26 tools (Urantia Papers + Bible + the other works + cross-references + quote checks + citations), 2 resource templates (`urantia://paper/{id}`, `urantia://entity/{id}`), and 2 prompt templates (`study_assistant`, `comparative_theology`) for Claude, Cursor, Windsurf, and other AI agents
- **Spanish** for all 197 papers: `?lang=es` on the papers, paragraphs, and table of contents endpoints, and `lang: "es"` on the MCP paper and paragraph tools. A machine translation, released as CC0; each paragraph has a `translation` label. With `include`, the Papers parallels (text and titles) and the entity names are in Spanish too; the Bible and the other works stay English. Keyword search takes `lang=es` too (`/search` and `search.fulltext`): the Spanish text, with accents folded, "documento 1" read as a reference, and Spanish marks; it has no typo fixes. Semantic search stays English
- **Works tools** — `works.list`, `works.search` (keyword, with references and typo fixes), `works.search.semantic` (with `strength`), `works.read`, and `works.urantia_parallels`, for the Bible and the 21 texts of the world's religions and traditions in one result shape; plus `quotes.verify` and `cite.get`
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
- **Feedback** — `POST /feedback` takes bug reports, docs gaps, and ideas from people and AI agents, no auth required

## Infrastructure

- **Cloudflare Workers** — global edge deployment
- **CDN caching** — 24h for static content, 1h for search, configurable
- **Rate limiting** — 200 req/min per IP
- **RFC 9457 error responses** — standard Problem Details format
- **Interactive docs** — Swagger UI at `/docs`
- **Status page** — `status.urantia.dev`

## Resources

- **Home**: [urantia.dev](https://urantia.dev)
- **API docs**: [docs.urantia.dev](https://docs.urantia.dev)
- **Interactive demo**: [demo.urantia.dev](https://demo.urantia.dev)
- **Reading platform**: [urantiahub.com](https://urantiahub.com)
- **OpenAPI spec**: [api.urantia.dev/openapi.json](https://api.urantia.dev/openapi.json)
- **MCP Server**: [api.urantia.dev/mcp](https://api.urantia.dev/mcp)

---

## Roadmap

- More translations (French, Portuguese, German, Korean)
- ElevenLabs premium audio narration
- Entity relationship graph visualization
- Community project directory
