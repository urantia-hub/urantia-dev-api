# Audio URL Restructuring Design

## Problem

The API currently returns a flat `audioUrl` string and `hasAudio` boolean per paragraph. This bakes in a single model/voice/format combo (`tts-1-hd-nova`) and isn't extensible to support the multiple model-voice combos that already exist on the CDN (`cdn.urantia.dev`).

## Design

### API Response Shape

Replace `audioUrl` (string) and `hasAudio` (boolean) with a single `audio` field — a nested object keyed by model > voice, or `null` when no audio exists.

```json
{
  "id": "3:119.1.5",
  "audio": {
    "tts-1-hd": {
      "nova": { "format": "mp3", "url": "https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-3:119.1.5.mp3" },
      "echo": { "format": "mp3", "url": "https://cdn.urantia.dev/audio/eng/paragraphs/echo/tts-1-hd-echo-3:119.1.5.mp3" }
    },
    "tts-1": {
      "alloy": { "format": "mp3", "url": "https://cdn.urantia.dev/audio/eng/paragraphs/alloy/tts-1-alloy-3:119.1.5.mp3" }
    }
  }
}
```

When no audio exists: `"audio": null`.

### Known Model-Voice Combos on CDN

| Prefix | File Count | Coverage |
|---|---|---|
| tts-1-hd-nova | 16,221 | Full |
| tts-1-hd-onyx | 158 | Partial |
| tts-1-hd-echo | 12 | Partial |
| tts-1-alloy | 4 | Partial |
| tts-1-hd-alloy | 3 | Partial |
| tts-1-hd-fable | 4 | Partial |
| tts-1-hd-shimmer | 3 | Partial |

Paper-level audio also exists at `papers/{paperId}.mp3`.

### Database Changes

- Remove `has_audio` column from `paragraphs` table
- Replace `audio_url` (text) column with `audio` (JSONB) column, nullable
- JSONB stores the nested model > voice > {format, url} structure

### Manifest Script

A new script in `urantia-dev-api` that scans the local mp3 directories and outputs a JSON manifest mapping each globalId to its available model-voice combos. The seed script reads this manifest to build the `audio` JSONB per paragraph.

### Affected Routes

All routes returning paragraph data need updating:
- `POST /search`
- `GET /paragraphs/random`
- `GET /paragraphs/{ref}`
- `GET /paragraphs/{ref}/context`
- `GET /papers/{id}` (paragraphs within)
- `GET /audio/{paragraphId}`

### Schema Changes

Update Zod schemas:
- `ParagraphSchema`: remove `hasAudio`, `audioUrl`; add `audio` as nested object or null
- `AudioResponse`: update to return the new audio object shape
- `SearchResultSchema`: inherits from updated ParagraphSchema
