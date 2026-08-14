# Data Pipeline

All source data for this API lives in the **`urantia-data-sources`** Cloudflare R2 bucket. This document explains how data flows from R2 into the database.

## Data Flow

```
R2: urantia-data-sources bucket
├── json/eng/             ──→  bun run seed          ──→  parts, papers, sections, paragraphs tables
├── entities/             ──→  bun run seed:entities  ──→  entities, paragraph_entities tables
├── embeddings/           ──→  (insert script)        ──→  paragraphs.embedding column
├── manifests/            ──→  (joined during seed)   ──→  paragraphs.audio column
└── audio/eng/            ──→  served via CDN at cdn.urantia.dev/audio/eng/
```

## Setup from Scratch

### 1. Download data from R2

Clone the `urantia-data-sources` repo and download the data you need:

```bash
cd ../urantia-data-sources
bun install
# Set up .env with R2 credentials (see .env.example)
bun run download json         # papers JSON (~43MB)
bun run download entities     # entity seeds (~7MB)
bun run download manifests    # audio manifest (~2.6MB)
bun run download embeddings   # vector embeddings (~455MB, optional)
```

Or set env vars to point directly at the downloaded data (see `.env.example`).

### 2. Set up database

```bash
bun run db:push    # push schema to Supabase (dev)
# or
bun run db:migrate # run migrations (prod)
```

### 3. Seed in order

```bash
bun run seed              # 1. Papers, sections, paragraphs (+ audio from manifest)
bun run seed:entities     # 2. Entities + paragraph-entity junction table
bun run generate-embeddings  # 3. Vector embeddings (requires OPENAI_API_KEY, ~$5)
```

## Environment Variables

All data paths can be overridden via environment variables. See `.env.example` for the full list.

| Variable | Default | Used By |
|----------|---------|---------|
| `DATA_DIR` | `../../urantia-data-sources/data/json/eng` | `seed.ts` |
| `AUDIO_MANIFEST` | `../data/audio-manifest.json` | `seed.ts` |
| `SEED_ENTITIES_PATH` | `../data/entities/seed-entities.json` | `seed-entities.ts` |
| `MP3_DIR` | `../../urantia-data-sources/data/audio/eng` | `generate-audio-manifest.ts` |
| `EMBEDDINGS_PATH` | `data/embeddings.json` | `generate-embeddings.ts` |

## Regenerating Derived Data

### Entities

Entities are derived from the [Urantiapedia](https://github.com/JanHerca/urantiapedia) topic index. To regenerate:

```bash
# Requires urantiapedia repo cloned as a sibling
TOPIC_INDEX_DIR=../../urantiapedia/input/txt/topic-index-en bun scripts/entities/parse-topic-index.ts
bun scripts/entities/build-paragraph-map.ts
# Then re-seed:
bun run seed:entities
```

### Audio Manifest

Regenerate from the MP3 files in R2/local:

```bash
bun run generate-manifest
```

This writes two copies: `data/audio-manifest.json` here, which `seed.ts` reads, and
`../urantia-data-sources/data/manifests/audio-manifest.json`, which the upload script
publishes. Regenerating does not publish. Upload it as a second step:

```bash
cd ../urantia-data-sources && bun run upload manifests
```

Both copies are gitignored, so nothing warns you when the published manifest falls
behind. It sat 19 days stale in August 2026 for exactly this reason. Check it with:

```bash
curl -s https://cdn.urantia.dev/manifests/audio-manifest.json | head -c 400
```

### Embeddings

Regenerate via OpenAI API (costs ~$5):

```bash
bun run generate-embeddings
```

## Database Tables

| Table | Records | Source |
|-------|---------|--------|
| `parts` | 5 | json/eng/ |
| `papers` | 197 | json/eng/ |
| `sections` | ~1,626 | json/eng/ |
| `paragraphs` | ~14,500 | json/eng/ + embeddings + audio manifest |
| `entities` | ~3,000+ | entities/seed-entities.json |
| `paragraph_entities` | ~50,000+ | entities/seed-entities.json (citations resolved) |
