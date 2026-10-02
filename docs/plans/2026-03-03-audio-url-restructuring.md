# Audio URL Restructuring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat `audioUrl` string and `hasAudio` boolean with a nested `audio` JSONB object keyed by model > voice, populated from a manifest of available audio files.

**Architecture:** A manifest generation script scans mp3 directories to determine which model-voice combos exist per paragraph globalId. The seed script reads this manifest to populate a JSONB `audio` column. All routes and Zod schemas are updated to return the new shape. The `has_audio` and `audio_url` columns are removed.

**Tech Stack:** Bun, Hono + @hono/zod-openapi, Drizzle ORM, Zod v4, PostgreSQL (Supabase)

---

### Task 1: Create the audio manifest generation script

**Files:**
- Create: `scripts/generate-audio-manifest.ts`

**Step 1: Write the manifest script**

This script scans the mp3 directory, parses filenames into model-voice-globalId tuples, and writes a JSON manifest.

```typescript
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MP3_DIR =
  process.env.MP3_DIR ??
  join(import.meta.dir, "../../urantia-hub-api/public/data/mp3/eng");

const CDN_BASE = "https://cdn.urantia.dev/audio/eng/paragraphs";

// Known model prefixes — order matters (longer first to avoid partial matches)
const MODEL_PREFIXES = ["tts-1-hd", "tts-1"] as const;

type AudioVariant = { model: string; voice: string; format: string; url: string };
type AudioManifest = Record<string, Record<string, Record<string, { format: string; url: string }>>>;

function parseFilename(filename: string): { model: string; voice: string; globalId: string; format: string } | null {
  if (!filename.endsWith(".mp3")) return null;

  for (const model of MODEL_PREFIXES) {
    const prefix = `${model}-`;
    if (filename.startsWith(prefix)) {
      const rest = filename.slice(prefix.length); // e.g. "nova-3:119.1.5.mp3"
      const dashIdx = rest.indexOf("-");
      if (dashIdx === -1) continue;

      const voice = rest.slice(0, dashIdx);
      const globalIdWithExt = rest.slice(dashIdx + 1); // e.g. "3:119.1.5.mp3"
      const globalId = globalIdWithExt.replace(/\.mp3$/, "");

      return { model, voice, globalId, format: "mp3" };
    }
  }
  return null;
}

console.log(`Scanning: ${MP3_DIR}`);

const files = readdirSync(MP3_DIR).filter((f) => f.endsWith(".mp3"));
const manifest: AudioManifest = {};

for (const file of files) {
  const parsed = parseFilename(file);
  if (!parsed) continue;

  const { model, voice, globalId, format } = parsed;

  if (!manifest[globalId]) manifest[globalId] = {};
  if (!manifest[globalId][model]) manifest[globalId][model] = {};

  manifest[globalId][model][voice] = {
    format,
    url: `${CDN_BASE}/${model}-${voice}-${globalId}.${format}`,
  };
}

const outputPath = join(import.meta.dir, "../data/audio-manifest.json");
writeFileSync(outputPath, JSON.stringify(manifest, null, 2));

const globalIds = Object.keys(manifest);
const totalVariants = globalIds.reduce(
  (sum, gid) =>
    sum +
    Object.values(manifest[gid]).reduce(
      (s, voices) => s + Object.keys(voices).length,
      0,
    ),
  0,
);

console.log(`Manifest written to: ${outputPath}`);
console.log(`  Paragraphs with audio: ${globalIds.length}`);
console.log(`  Total variants: ${totalVariants}`);
```

**Step 2: Create data directory and add manifest script to package.json**

Run: `mkdir -p data`

Add to `package.json` scripts:
```json
"generate-manifest": "bun scripts/generate-audio-manifest.ts"
```

**Step 3: Run the manifest script**

Run: `bun run generate-manifest`
Expected: `data/audio-manifest.json` created with ~16,000+ paragraph entries.

**Step 4: Commit**

```bash
git add scripts/generate-audio-manifest.ts data/audio-manifest.json package.json
git commit -m "feat: add audio manifest generation script"
```

---

### Task 2: Update database schema

**Files:**
- Modify: `src/db/schema.ts:62-106`

**Step 1: Replace has_audio and audio_url with audio JSONB column**

In `src/db/schema.ts`, replace the `hasAudio` and `audioUrl` column definitions with a single JSONB `audio` column.

Add a new custom type for JSONB:

```typescript
const jsonb = customType<{ data: Record<string, unknown> | null }>({
  dataType() {
    return "jsonb";
  },
});
```

Then replace these two lines in the paragraphs table:
```typescript
// Remove:
hasAudio: boolean("has_audio").notNull().default(false),
audioUrl: text("audio_url"),

// Replace with:
audio: jsonb("audio"),
```

**Step 2: Push schema changes**

Run: `bunx drizzle-kit push --force`
Expected: Schema updates applied (drops `has_audio` and `audio_url`, adds `audio` JSONB column).

**Step 3: Commit**

```bash
git add src/db/schema.ts
git commit -m "feat: replace has_audio/audio_url with audio JSONB column"
```

---

### Task 3: Update Zod schemas

**Files:**
- Modify: `src/validators/schemas.ts:48-66` (ParagraphSchema)
- Modify: `src/validators/schemas.ts:146-154` (AudioResponse)

**Step 1: Define the audio Zod schema and update ParagraphSchema**

Replace the `hasAudio` and `audioUrl` fields in `ParagraphSchema` with the new nested `audio` field:

```typescript
// Add above ParagraphSchema:
const AudioVariantSchema = z.object({
  format: z.string(),
  url: z.string(),
});

const AudioSchema = z.record(
  z.string(), // model key (e.g. "tts-1-hd")
  z.record(
    z.string(), // voice key (e.g. "nova")
    AudioVariantSchema,
  ),
).nullable();
```

In `ParagraphSchema`, replace:
```typescript
// Remove:
hasAudio: z.boolean(),
audioUrl: z.string().nullable(),

// Replace with:
audio: AudioSchema,
```

**Step 2: Update AudioResponse**

Replace the `AudioResponse` schema:

```typescript
export const AudioResponse = z.object({
  data: z.object({
    paragraphId: z.string(),
    audio: AudioSchema,
  }),
});
```

**Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: Type errors in route files (expected — we'll fix those next).

**Step 4: Commit**

```bash
git add src/validators/schemas.ts
git commit -m "feat: update Zod schemas for nested audio object"
```

---

### Task 4: Update seed script to use manifest

**Files:**
- Modify: `scripts/seed.ts`

**Step 1: Update seed to read manifest and populate audio JSONB**

Replace the CDN_BASE/AUDIO_PREFIX constants and audio field assignment:

```typescript
// Remove:
const CDN_BASE = "https://cdn.urantia.dev/audio/eng/paragraphs";
const AUDIO_PREFIX = `${CDN_BASE}/tts-1-hd-nova-`;

// Add:
import { existsSync } from "node:fs";

const MANIFEST_PATH =
  process.env.AUDIO_MANIFEST ??
  join(import.meta.dir, "../data/audio-manifest.json");

let audioManifest: Record<string, Record<string, Record<string, { format: string; url: string }>>> = {};
if (existsSync(MANIFEST_PATH)) {
  audioManifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  console.log(`Audio manifest loaded: ${Object.keys(audioManifest).length} paragraphs`);
} else {
  console.warn(`Audio manifest not found at ${MANIFEST_PATH} — audio will be null`);
}
```

In the paragraph values mapping, replace the audio fields:

```typescript
// Remove:
hasAudio: true,
audioUrl: `${AUDIO_PREFIX}${p.globalId}.mp3`,

// Replace with:
audio: audioManifest[p.globalId] ?? null,
```

**Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS (or only route-related errors remain).

**Step 3: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat: update seed script to use audio manifest for JSONB"
```

---

### Task 5: Update route files

**Files:**
- Modify: `src/routes/paragraphs.ts:17-35` (paragraphFields)
- Modify: `src/routes/search.ts:99-118` (select fields)
- Modify: `src/routes/papers.ts:86-105` (select fields)
- Modify: `src/routes/audio.ts:41-104` (entire handler)

**Step 1: Update paragraphs.ts — paragraphFields helper**

Replace `hasAudio` and `audioUrl` in the `paragraphFields` object:

```typescript
// Remove:
hasAudio: paragraphs.hasAudio,
audioUrl: paragraphs.audioUrl,

// Replace with:
audio: paragraphs.audio,
```

**Step 2: Update search.ts — select fields**

In the search results select, replace:

```typescript
// Remove:
hasAudio: paragraphs.hasAudio,
audioUrl: paragraphs.audioUrl,

// Replace with:
audio: paragraphs.audio,
```

**Step 3: Update papers.ts — select fields**

In the `getPaper` handler's select for `paperParagraphs`, replace:

```typescript
// Remove:
hasAudio: paragraphs.hasAudio,
audioUrl: paragraphs.audioUrl,

// Replace with:
audio: paragraphs.audio,
```

**Step 4: Update audio.ts — entire handler**

Rewrite the audio route handler to use the new `audio` column:

```typescript
audioRoute.openapi(getAudioRoute, async (c) => {
  const { paragraphId } = c.req.valid("param");
  const format = detectRefFormat(paragraphId);

  const col =
    format === "globalId"
      ? paragraphs.globalId
      : format === "standardReferenceId"
        ? paragraphs.standardReferenceId
        : format === "paperSectionParagraphId"
          ? paragraphs.paperSectionParagraphId
          : null;

  if (!col) {
    return c.json(
      { error: `Invalid paragraph reference: "${paragraphId}"` },
      404,
    );
  }

  const result = await db
    .select({
      globalId: paragraphs.globalId,
      audio: paragraphs.audio,
    })
    .from(paragraphs)
    .where(eq(col, paragraphId))
    .limit(1);

  if (!result || result.length === 0) {
    return c.json(
      { error: `Paragraph "${paragraphId}" not found` },
      404,
    );
  }

  const row = result[0]!;
  return c.json(
    {
      data: {
        paragraphId: row.globalId,
        audio: row.audio ?? null,
      },
    },
    200,
  );
});
```

**Step 5: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

**Step 6: Run lint**

Run: `bun run lint`
Expected: PASS (fix any issues).

**Step 7: Commit**

```bash
git add src/routes/paragraphs.ts src/routes/search.ts src/routes/papers.ts src/routes/audio.ts
git commit -m "feat: update all routes to use audio JSONB column"
```

---

### Task 6: Re-seed database and verify

**Step 1: Truncate paragraphs and re-seed**

```bash
psql "$DATABASE_URL" -c "TRUNCATE paragraphs CASCADE;" && bun run seed
```

**Step 2: Start dev server and test**

Run: `bun run dev`

Test the search endpoint:
```bash
curl -s -X POST http://localhost:3000/search -H 'Content-Type: application/json' -d '{"q":"Melchizedek"}' | jq '.data[0].audio'
```

Expected: Nested audio object like:
```json
{
  "tts-1-hd": {
    "nova": {
      "format": "mp3",
      "url": "https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-..."
    }
  }
}
```

Test the audio endpoint:
```bash
curl -s http://localhost:3000/audio/119:1.5 | jq '.data'
```

Expected:
```json
{
  "paragraphId": "3:119.1.5",
  "audio": { "tts-1-hd": { "nova": { ... } } }
}
```

**Step 3: Verify no old fields remain**

```bash
curl -s -X POST http://localhost:3000/search -H 'Content-Type: application/json' -d '{"q":"Melchizedek"}' | jq '.data[0] | keys'
```

Expected: No `hasAudio` or `audioUrl` keys. Should include `audio` key.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: re-seed database with audio manifest data"
```
