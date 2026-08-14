# Urantia Papers TTS Audio Generation — Game Plan

## Project Goal

Generate ~14,500+ MP3 files — one per paragraph + section title + paper title + part title of The Urantia Book — using ElevenLabs' Eleven v3 model with dynamic voice assignment based on:

1. **Paper author** (the celestial being credited at the bottom of each paper)
2. **Dialogue speaker** (Jesus, apostles, and other characters in quoted speech)
3. **Consistent tonal flow** between consecutive paragraphs

The existing audio lives at `https://cdn.urantia.dev/audio/eng/paragraphs/{voice}/` using OpenAI's `tts-1-hd` model with the `nova` voice. We're replacing that with dramatically higher quality, multi-voice narration.

---

## Local Resources Available

Everything needed is already on disk — no scraping or large API fetching required.

### Source Text
- **`/urantia-papers-json/data/json/eng/`** — 197 JSON files (`000.json`–`196.json`) + 4 part files. Each contains all paragraphs, sections, and paper metadata as `RawJsonNode` objects with `text`, `htmlText`, `labels`, `globalId`, `standardReferenceId`, `sortId`, etc.
- **Labels field**: Paper-level nodes have topic labels like `["Spirituality", "Theology", "Philosophy"]`. Section/paragraph nodes have empty label arrays — so labels won't help with voice assignment, but could inform emotion tagging for cosmic/spiritual passages.

### Existing Audio (OpenAI TTS)
- **`/original_audio_ub/`** — 16,413 MP3 files (~8.6 GB). Naming: `tts-{model}-{voice}-{globalId}.mp3`. Models: `tts-1`, `tts-1-hd`. Voices: `alloy`, `echo`, `fable`, `nova`, `onyx`, `shimmer`. Also includes audiobook intro/outro/background music files.
- **`/urantia-dev-api/data/audio-manifest.json`** (2.6 MB) — Maps every `globalId` → model → voice → `{format, url}`. 16,221 entries. This is the source of truth for the `audio` JSONB field in the database.

### Database & API
- **DB schema**: `paragraphs` table has `audio` JSONB column structured as `{model: {voice: {format, url}}}`. New ElevenLabs audio slots in alongside existing OpenAI audio — no replacement needed.
- **Audio manifest generator**: `scripts/generate-audio-manifest.ts` scans an MP3 directory, parses filenames, and builds the manifest JSON. Can be adapted for ElevenLabs output.
- **Seed script**: `scripts/seed.ts` reads JSON files + audio manifest and populates the DB. Re-run after generating new audio to update the `audio` field.
- **API response shape** (post slim-down): Paragraph `audio` field is `Record<model, Record<voice, {format, url}>> | null`. The `id` field is the `globalId` (e.g., `"1:2.0.1"`). Fields removed: `globalId` (redundant with `id`), `paperSectionParagraphId`, `language`.

### Embeddings
- **`/urantia-dev-api/data/embeddings.json`** (455 MB) — 1536-dim vectors for every paragraph. Could potentially be used for semantic clustering of "similar tone" passages to help with emotion tagging, though this is optional.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Phase 1: Data Extraction & Metadata                     │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Fetch all     │──▶│ Parse author │──▶│ Detect       │ │
│  │ paragraphs    │   │ per paper    │   │ dialogue &   │ │
│  │ from API      │   │              │   │ speakers     │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 2: Voice Design & Pronunciation                   │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Create voice  │──▶│ Build pronun-│──▶│ Test & tune  │ │
│  │ palette (20+) │   │ ciation dict │   │ sample paras │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 3: Batch Generation                               │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Queue all     │──▶│ Call Eleven- │──▶│ Save MP3s &  │ │
│  │ paragraphs    │   │ Labs API per │   │ upload       │ │
│  │ with voice    │   │ paragraph    │   │              │ │
│  │ assignments   │   │              │   │              │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
└────────────────────────────┬────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│  Phase 4: QA & Upload                                    │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ Spot check    │──▶│ Regenerate   │──▶│ Replace old  │ │
│  │ samples per   │   │ failures     │   │ audio files  │ │
│  │ voice/paper   │   │              │   │              │ │
│  └──────────────┘   └──────────────┘   └──────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## Phase 1: Data Extraction & Metadata Map

### 1.1 The Urantia Papers API (api.urantia.dev)

Good news: the API already has everything we need. No scraping required.

**Base URL:** `https://api.urantia.dev`
**Auth:** None required (free, open access)
**Rate limit:** 100 requests/minute/IP
**OpenAPI spec:** `https://api.urantia.dev/openapi.json`
**Interactive docs:** `https://api.urantia.dev/docs` (Swagger UI)
**Full docs site:** `https://urantia.dev`
**LLM context:** `https://urantia.dev/llms.txt`

### 1.2 Key API Endpoints

**Get all papers (metadata):**
```
GET /papers
→ Returns array of all 197 papers with id, partId, title, sortId, labels
```

**Get a full paper with all paragraphs and text:**
```
GET /papers/{id}
→ Returns paper metadata + ALL paragraphs with full text, htmlText, labels, audio
```
This is the main workhorse endpoint. Call it for papers 0-196 and you have every
paragraph in the book with its text already included.

**Get a single paragraph by reference:**
```
GET /paragraphs/{ref}
```
Three reference formats are auto-detected:
- `globalId`: `1:2.0.1` (partId:paperId.sectionId.paragraphId)
- `standardReferenceId`: `2:0.1` (paperId:sectionId.paragraphId)
- `paperSectionParagraphId`: `2.0.1` (paperId.sectionId.paragraphId)

**Get paragraph with surrounding context (great for dialogue detection):**
```
GET /paragraphs/{ref}/context?window=3
→ Returns target paragraph + N paragraphs before/after
```

**Get sections within a paper:**
```
GET /papers/{id}/sections
→ Returns all sections with id, paperId, sectionId, title, globalId, sortId
```

**Full-text search:**
```
POST /search
Body: {"q": "Jesus said", "type": "phrase", "limit": 100, "paperId": "139"}
→ Supports "and", "or", "phrase" modes + paperId/partId filters
```

**Semantic search (vector embeddings):**
```
POST /search/semantic
Body: {"q": "teachings about love and forgiveness", "limit": 20}
→ Finds conceptually related passages even without keyword matches
```

**Get audio URL:**
```
GET /audio/{paragraphId}
→ Returns existing audio URLs (currently tts-1-hd/nova)
```

### 1.3 Paragraph Data Model

Each paragraph from the API contains (post slim-down):
```json
{
  "id": "1:2.0.1",               // globalId (was separate field, now just "id")
  "standardReferenceId": "2:0.1", // standard ref format
  "sortId": "1.002.000.001",      // for ordering
  "paperId": "2",
  "sectionId": "0",               // just the section number (was composite "2.0")
  "partId": "1",
  "paperTitle": "The Nature of God",
  "sectionTitle": null,            // nullable
  "paragraphId": "1",
  "text": "The plain text content...",
  "htmlText": "<span class=\"...\">Formatted text...</span>",
  "labels": [],                    // topic labels on paper nodes only (see below)
  "audio": {                       // nullable, supports multiple models/voices
    "tts-1-hd": {
      "nova": { "url": "https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-1:2.0.1.mp3", "format": "mp3" },
      "onyx": { "url": "https://cdn.urantia.dev/audio/eng/paragraphs/onyx/tts-1-hd-onyx-1:2.0.1.mp3", "format": "mp3" }
    }
  }
}
```

**Removed fields** (no longer in API responses): `globalId` (= `id`), `paperSectionParagraphId` (derivable), `language` (always "eng").

**Labels field:** Inspected — paper-level nodes have topic labels like `["Spirituality", "Theology", "Philosophy"]`. Paragraph/section nodes have empty arrays. Won't help with voice assignment, but the topic labels could inform emotion tagging (e.g., papers labeled "Cosmology" might get the `cosmic_awe` treatment).

### 1.4 Data Fetching Strategy

**No API calls needed.** All source text is already available locally at `/urantia-papers-json/data/json/eng/`. Read the 197 JSON files directly.

**Step 1:** Read all 197 JSON files (`000.json`–`196.json`). Filter nodes where `type === "paragraph"`. Each file contains all paragraphs for that paper with full text.

**Step 2:** Store as `paragraphs.json` — flat array of all ~14,500+ paragraphs
with enriched metadata:

```json
{
  "id": "1:2.0.1",
  "standardReferenceId": "2:0.1",
  "paperId": "2",
  "sectionId": "0",
  "partId": "1",
  "paperTitle": "The Nature of God",
  "sectionTitle": "...",
  "text": "The actual paragraph text...",
  "labels": [],
  "paperAuthor": "Divine Counselor",       // enriched from PAPER_AUTHORS map
  "detectedSpeaker": null,                 // populated by dialogue detection
  "voiceId": "voice_divine_counselor_01",  // populated by voice assignment
  "existingAudioUrl": "https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-2:0.1.mp3"
}
```

### 1.3 Complete Author-to-Paper Mapping

There are ~22 distinct author types across 196 papers. Here is the complete mapping:

```
PAPER_AUTHORS = {
    # Part I: The Central and Superuniverses (Papers 1-31)
    # Foreword (Paper 0): Divine Counselor
    0: "Divine Counselor",
    1: "Divine Counselor",
    2: "Divine Counselor",
    3: "Divine Counselor",
    4: "Divine Counselor",
    5: "Divine Counselor",
    6: "Divine Counselor",
    7: "Divine Counselor",
    8: "Divine Counselor",
    9: "Universal Censor",
    10: "Universal Censor",
    11: "Perfector of Wisdom",
    12: "Perfector of Wisdom",
    13: "Perfector of Wisdom",
    14: "Perfector of Wisdom",
    15: "Universal Censor",
    16: "Universal Censor",
    17: "Divine Counselor",
    18: "Divine Counselor",
    19: "Divine Counselor",
    20: "Perfector of Wisdom",
    21: "Perfector of Wisdom",
    22: "Mighty Messenger",
    23: "Divine Counselor",
    24: "Divine Counselor",
    25: "One High in Authority",
    26: "Perfector of Wisdom",
    27: "Perfector of Wisdom",
    28: "Mighty Messenger",
    29: "Universal Censor",
    30: "Mighty Messenger",
    31: "Divine Counselor and One Without Name and Number",

    # Part II: The Local Universe (Papers 32-56)
    32: "Mighty Messenger",
    33: "Chief of Archangels",
    34: "Mighty Messenger",
    35: "Chief of Archangels",
    36: "Vorondadek Son",
    37: "Brilliant Evening Star",
    38: "Melchizedek",
    39: "Melchizedek",
    40: "Mighty Messenger",
    41: "Archangel",
    42: "Mighty Messenger",
    43: "Malavatia Melchizedek",
    44: "Archangel",
    45: "Melchizedek",
    46: "Archangel",
    47: "Brilliant Evening Star",
    48: "Archangel",
    49: "Melchizedek",
    50: "Secondary Lanonandek",
    51: "Secondary Lanonandek",
    52: "Mighty Messenger",
    53: "Manovandet Melchizedek",
    54: "Mighty Messenger",
    55: "Mighty Messenger",
    56: "Mighty Messenger and Machiventa Melchizedek",

    # Part III: The History of Urantia (Papers 57-119)
    57: "Life Carrier",
    58: "Life Carrier",
    59: "Life Carrier",
    60: "Life Carrier",
    61: "Life Carrier",
    62: "Life Carrier",
    63: "Life Carrier",
    64: "Life Carrier",
    65: "Life Carrier",
    66: "Melchizedek",
    67: "Melchizedek",
    68: "Melchizedek",
    69: "Melchizedek",
    70: "Melchizedek",
    71: "Melchizedek",
    72: "Melchizedek",
    73: "Solonia",
    74: "Solonia",
    75: "Solonia",
    76: "Solonia",
    77: "Archangel",
    78: "Archangel",
    79: "Archangel",
    80: "Archangel",
    81: "Archangel",
    82: "Chief of Seraphim",
    83: "Chief of Seraphim",
    84: "Chief of Seraphim",
    85: "Brilliant Evening Star",
    86: "Brilliant Evening Star",
    87: "Brilliant Evening Star",
    88: "Brilliant Evening Star",
    89: "Brilliant Evening Star",
    90: "Melchizedek",
    91: "Midwayer Commission",  # Note: some sources say Chief of Midwayers
    92: "Melchizedek",
    93: "Melchizedek",
    94: "Melchizedek",
    95: "Melchizedek",
    96: "Melchizedek",
    97: "Melchizedek",
    98: "Melchizedek",
    99: "Melchizedek",
    100: "Melchizedek",
    101: "Melchizedek",
    102: "Melchizedek",
    103: "Melchizedek",
    104: "Melchizedek",
    105: "Melchizedek",
    106: "Melchizedek",
    107: "Solitary Messenger",
    108: "Solitary Messenger",
    109: "Solitary Messenger",
    110: "Solitary Messenger",
    111: "Solitary Messenger",
    112: "Solitary Messenger",
    113: "Chief of Seraphim",
    114: "Chief of Seraphim",
    115: "Mighty Messenger",
    116: "Mighty Messenger",
    117: "Mighty Messenger",
    118: "Mighty Messenger",
    119: "Chief of Evening Stars",

    # Part IV: The Life and Teachings of Jesus (Papers 120-196)
    120: "Mantutia Melchizedek",
    # Papers 121-196: ALL authored by Midwayer Commission
    **{i: "Midwayer Commission" for i in range(121, 197)}
}
```

### 1.4 Dialogue Detection (Papers 120-196 especially)

The Jesus papers contain extensive quoted dialogue. Detection strategy:

**Pattern 1 — Explicit quote marks:**
```
Jesus said: "The kingdom of heaven is within you."
```

**Pattern 2 — Attributed speech:**
```
Then Peter answered: "Lord, we have left everything..."
And Jesus replied, saying: "..."
```

**Pattern 3 — The author's closing signature** at the bottom of each paper:
```
[Presented by a Divine Counselor.]
[Indited by a Melchizedek of Nebadon.]
[Sponsored by a Midwayer Commission.]
```

**Action item for Claude Code:** Build a dialogue parser that:
1. Uses regex to detect quoted speech patterns
2. Identifies the speaker from the attribution text preceding the quote
3. Maps speakers to a known character list
4. For paragraphs with mixed narration + dialogue, decides whether to split into multiple TTS calls or use a single voice

**Key dialogue characters to detect (especially in Papers 120-196):**
```
DIALOGUE_CHARACTERS = [
    "Jesus",
    "Peter",           # Simon Peter
    "John",            # John Zebedee
    "James",           # James Zebedee
    "Andrew",
    "Philip",
    "Nathaniel",       # Bartholomew
    "Matthew",         # Levi
    "Thomas",
    "Simon Zelotes",
    "Judas Alpheus",   # Thaddeus
    "Judas Iscariot",
    "Pilate",          # Pontius Pilate
    "Caiaphas",
    "Herod",
    "Mary",            # Mother of Jesus
    "Mary Magdalene",
    "Martha",
    "Lazarus",
    "Nicodemus",
    "David Zebedee",
    "Abner",
    "Rodan",
    "Ganid",
    "Gonod",
    "Ruth",            # Sister of Jesus
    "Joseph",          # Father of Jesus
    "John the Baptist",
]
```

### 1.5 Voice Assignment Logic (Pseudocode)

```python
def assign_voice(paragraph):
    """
    Returns the ElevenLabs voice_id and any emotion tags to use.
    """
    paper_num = paragraph["paper"]
    text = paragraph["text"]
    author = PAPER_AUTHORS[paper_num]

    # Step 1: Check if this is a closing author attribution line
    # e.g., "[Presented by a Divine Counselor.]"
    if is_author_attribution(text):
        return VOICE_MAP[author], "[solemnly]"

    # Step 2: Check for dialogue (quoted speech)
    dialogue_segments = detect_dialogue(text)

    if not dialogue_segments:
        # Pure narration — use the paper author's voice
        return VOICE_MAP[author], determine_emotion(text, "narration")

    if len(dialogue_segments) == 1 and is_entirely_quoted(text):
        # Paragraph is entirely a single character speaking
        speaker = dialogue_segments[0]["speaker"]
        return VOICE_MAP.get(speaker, VOICE_MAP[author]), determine_emotion(text, "dialogue")

    # Mixed narration + dialogue
    # DECISION POINT: Two approaches here:
    #
    # Approach A (Simpler): Use the author's voice for everything.
    #   Pros: Consistent, no splicing needed, 1 API call per paragraph.
    #   Cons: Loses character differentiation in dialogue.
    #
    # Approach B (Premium): Split into segments, generate each with
    #   appropriate voice, then concatenate audio.
    #   Pros: True multi-voice dialogue experience.
    #   Cons: More complex, more API calls, need audio splicing.
    #
    # RECOMMENDATION: Start with Approach A for the initial run.
    # Move to Approach B for the Jesus papers (120-196) in a second pass.

    return VOICE_MAP[author], determine_emotion(text, "narration")
```

---

## Phase 2: Voice Design & Pronunciation

### 2.1 Voice Palette Design

You need ~20-30 distinct voices. Group them by character archetype:

```
VOICE_MAP = {
    # === NARRATION VOICES (Paper Authors) ===

    # Group 1: Divine/High Authority (deep, resonant, authoritative)
    "Divine Counselor":     "voice_id_01",  # Warm baritone, wise, measured
    "Perfector of Wisdom":  "voice_id_02",  # Slightly deeper, contemplative
    "Universal Censor":     "voice_id_03",  # Precise, judicial, clear

    # Group 2: Messengers (clear, energetic, narrative)
    "Mighty Messenger":     "voice_id_04",  # Strong, confident narrator
    "Solitary Messenger":   "voice_id_05",  # More intimate, reflective
    "One High in Authority":"voice_id_06",  # Commanding but warm
    "One Without Name and Number": "voice_id_07",  # Ethereal, unusual

    # Group 3: Archangels & Seraphim (bright, expressive)
    "Archangel":            "voice_id_08",  # Clear, ringing, articulate
    "Chief of Archangels":  "voice_id_09",  # Slightly more commanding
    "Chief of Seraphim":    "voice_id_10",  # Gentle but authoritative
    "Chief of Evening Stars":"voice_id_11", # Lyrical, storytelling quality
    "Brilliant Evening Star":"voice_id_12", # Similar but distinct timbre

    # Group 4: Melchizedeks (scholarly, narrative, steady)
    "Melchizedek":          "voice_id_13",  # Scholarly, steady narrator
    "Malavatia Melchizedek":"voice_id_13",  # Same voice (same order)
    "Manovandet Melchizedek":"voice_id_13", # Same voice (same order)
    "Mantutia Melchizedek": "voice_id_14",  # Distinct (director role)
    "Machiventa Melchizedek":"voice_id_15", # Distinct (important character)

    # Group 5: Specialized authors
    "Life Carrier":         "voice_id_16",  # Scientific, observational
    "Vorondadek Son":       "voice_id_17",  # Administrative, clear
    "Secondary Lanonandek": "voice_id_18",  # Local, practical
    "Solonia":              "voice_id_19",  # Female voice (seraphic)
    "Midwayer Commission":  "voice_id_20",  # The primary Jesus papers narrator

    # === DIALOGUE VOICES (Characters) ===

    "Jesus":                "voice_id_21",  # THE key voice. Warm, compelling,
                                            # authoritative yet gentle. This is
                                            # the most important voice choice.
    "Peter":                "voice_id_22",  # Bold, impulsive, earnest
    "John":                 "voice_id_23",  # Gentle, thoughtful, young
    "Thomas":               "voice_id_24",  # Questioning, skeptical, intellectual
    "Judas Iscariot":       "voice_id_25",  # Intense, slightly strained
    "Pilate":               "voice_id_26",  # Roman authority, detached
    "John the Baptist":     "voice_id_27",  # Fiery, prophetic

    # Minor characters can share voices or use a generic pool
    "GENERIC_MALE":         "voice_id_28",
    "GENERIC_FEMALE":       "voice_id_29",
}
```

### 2.2 How to Create the Voices in ElevenLabs

**Option A — Use ElevenLabs Voice Library:**
Browse `https://elevenlabs.io/voice-library` and filter by:
- Language: English
- Use case: Narration / Audiobook
- Select voices with appropriate age, gender, accent characteristics
- Save each to your library → get `voice_id`

**Option B — Design voices with the Voice Design API (V3):**
```
POST https://api.elevenlabs.io/v1/text-to-voice/create-previews
{
    "voice_description": "A deep, resonant male voice with a wise and
     authoritative quality. Speaks with measured cadence, as if imparting
     profound cosmic truths. Warm but distant, like a benevolent teacher
     speaking across vast distances of space and time.",
    "text": "Sample text from the Urantia Book for this voice...",
    "model_id": "eleven_ttv_v3"
}
```

**Option C — Clone from reference audio:**
Record or find reference audio clips that match each character archetype. Use ElevenLabs Instant Voice Clone:
```
POST https://api.elevenlabs.io/v1/voices/add
Content-Type: multipart/form-data

name: "Divine Counselor"
files: [reference_audio.mp3]  // at least 30 seconds of clean audio
```

### 2.3 Pronunciation Dictionary

The Urantia Book contains hundreds of invented proper nouns. Create an ElevenLabs pronunciation dictionary.

**Step 1: Extract all unique proper nouns from the text.**

```python
# Regex patterns to catch capitalized multi-word names and unusual words
import re

KNOWN_TERMS = [
    # Universe/Place names
    ("Urantia",       "yoo-RAN-sha"),
    ("Nebadon",       "NEB-ah-don"),
    ("Orvonton",      "or-VON-ton"),
    ("Uversa",        "yoo-VER-sah"),
    ("Havona",        "hah-VOH-nah"),
    ("Salvington",    "SAL-ving-ton"),
    ("Edentia",       "eh-DEN-sha"),
    ("Jerusem",       "jeh-ROO-sem"),
    ("Satania",       "sah-TAY-nee-ah"),
    ("Norlatiadek",   "nor-LAH-tee-ah-dek"),
    ("Monmatia",      "mon-MAY-sha"),
    ("Divinington",   "dih-VIN-ing-ton"),
    ("Sonarington",   "son-AIR-ing-ton"),
    ("Ascendington",  "ah-SEND-ing-ton"),
    ("Fensalington",  "fen-SAL-ing-ton"),

    # Being/Order names
    ("Melchizedek",   "mel-KIZ-eh-dek"),
    ("Lanonandek",    "lah-NON-an-dek"),
    ("Vorondadek",    "vor-ON-dah-dek"),
    ("Caligastia",    "kal-ih-GAS-tee-ah"),
    ("Daligastia",    "dal-ih-GAS-tee-ah"),
    ("Machiventa",    "mak-ih-VEN-tah"),
    ("Mantutia",      "man-TOO-sha"),
    ("Malavatia",     "mal-ah-VAY-sha"),
    ("Manovandet",    "man-oh-VAN-det"),
    ("Tabamantia",    "tab-ah-MAN-sha"),
    ("Lanaforge",     "LAN-ah-forj"),
    ("Solonia",       "soh-LOH-nee-ah"),
    ("Amadon",        "AM-ah-don"),
    ("Andon",         "AN-don"),
    ("Fonta",         "FON-tah"),
    ("Andonic",       "an-DON-ik"),
    ("Sangik",        "SANG-ik"),

    # Concept terms
    ("morontia",      "moh-RON-sha"),
    ("absonite",      "AB-soh-nite"),
    ("superuniverse",  "SOO-per-YOO-nih-verse"),
    ("finaliter",     "FY-nal-eye-ter"),
    ("Adjuster",      "ad-JUS-ter"),
    ("bestowal",      "bih-STOW-al"),
]
```

**Step 2: Create the dictionary via API:**
```
POST https://api.elevenlabs.io/v1/pronunciation-dictionaries/add-from-file
Content-Type: multipart/form-data

name: "urantia_pronunciation"
file: urantia_terms.pls  (PLS or lexicon format)
```

**PLS file format example:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<lexicon version="1.0" xmlns="http://www.w3.org/2005/01/pronunciation-lexicon"
         alphabet="ipa" xml:lang="en">
    <lexeme>
        <grapheme>Urantia</grapheme>
        <phoneme>jʊˈɹænʃə</phoneme>
    </lexeme>
    <lexeme>
        <grapheme>Nebadon</grapheme>
        <phoneme>ˈnɛbədɒn</phoneme>
    </lexeme>
    <lexeme>
        <grapheme>morontia</grapheme>
        <phoneme>moʊˈɹɒnʃə</phoneme>
    </lexeme>
</lexicon>
```

**Note:** You'll want to listen to test generations and iteratively refine pronunciations. Some terms have debated pronunciations within the Urantia community — pick one and stay consistent.

---

## Phase 3: Batch Audio Generation

### 3.1 ElevenLabs API Call Structure

```python
import requests
import os
import time
import json

ELEVENLABS_API_KEY = os.environ["ELEVENLABS_API_KEY"]
BASE_URL = "https://api.elevenlabs.io/v1"

# Model choices:
#   "eleven_v3"               — Best quality, highest expressiveness (recommended)
#   "eleven_multilingual_v2"  — Great quality, lower latency
#   "eleven_flash_v2_5"       — Fastest, cheapest, good quality

MODEL_ID = "eleven_v3"

# Pronunciation dictionary (create this first via API, then reference here)
PRONUNCIATION_DICT_ID = "your_dict_id_here"
PRONUNCIATION_DICT_VERSION = "your_version_id_here"

def generate_paragraph_audio(paragraph_data, output_dir="./output"):
    """
    Generate a single MP3 file for one paragraph.
    """
    voice_id = paragraph_data["voiceId"]
    text = paragraph_data["text"]
    paragraph_id = paragraph_data["paragraphId"]

    # Sanitize paragraph ID for filename
    safe_id = paragraph_id.replace(":", "-").replace(".", "_")
    output_path = os.path.join(output_dir, f"eleven-v3-{safe_id}.mp3")

    # Skip if already generated
    if os.path.exists(output_path):
        return output_path

    url = f"{BASE_URL}/text-to-speech/{voice_id}"

    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
    }

    payload = {
        "text": text,
        "model_id": MODEL_ID,
        "language_code": "en",
        "voice_settings": {
            "stability": 0.6,        # 0.0 = more variable, 1.0 = more stable
            "similarity_boost": 0.85, # How closely to match the voice
            "style": 0.3,            # Expressiveness (0 = neutral, 1 = max)
            "use_speaker_boost": True
        },
        "pronunciation_dictionary_locators": [
            {
                "pronunciation_dictionary_id": PRONUNCIATION_DICT_ID,
                "version_id": PRONUNCIATION_DICT_VERSION
            }
        ],
        # Use a seed for reproducibility (optional but helpful for consistency)
        # "seed": hash(paragraph_id) % 2**32,
    }

    response = requests.post(url, json=payload, headers=headers)

    if response.status_code == 200:
        with open(output_path, "wb") as f:
            f.write(response.content)
        return output_path
    else:
        print(f"ERROR on {paragraph_id}: {response.status_code} - {response.text}")
        return None
```

### 3.2 Batch Processing with Rate Limiting

```python
import asyncio
import aiohttp
from collections import deque

class ElevenLabsBatchProcessor:
    """
    Process all paragraphs with rate limiting and retry logic.

    ElevenLabs rate limits:
    - Free: 2 concurrent requests
    - Starter: 3 concurrent
    - Creator: 5 concurrent
    - Pro: 10 concurrent
    - Scale: 15 concurrent
    - Business: 20 concurrent
    """

    def __init__(self, api_key, max_concurrent=5, retry_limit=3):
        self.api_key = api_key
        self.max_concurrent = max_concurrent
        self.retry_limit = retry_limit
        self.semaphore = asyncio.Semaphore(max_concurrent)
        self.results = []
        self.failures = []

    async def generate_one(self, session, paragraph, output_dir):
        async with self.semaphore:
            for attempt in range(self.retry_limit):
                try:
                    result = await self._call_api(session, paragraph, output_dir)
                    if result:
                        self.results.append(paragraph["paragraphId"])
                        return result
                except Exception as e:
                    wait_time = 2 ** attempt  # Exponential backoff
                    print(f"Retry {attempt+1} for {paragraph['paragraphId']}: {e}")
                    await asyncio.sleep(wait_time)

            self.failures.append(paragraph["paragraphId"])
            return None

    async def process_all(self, paragraphs, output_dir):
        """Process all paragraphs with progress tracking."""
        os.makedirs(output_dir, exist_ok=True)

        async with aiohttp.ClientSession() as session:
            tasks = [
                self.generate_one(session, p, output_dir)
                for p in paragraphs
            ]

            # Process with progress bar
            total = len(tasks)
            for i, coro in enumerate(asyncio.as_completed(tasks)):
                await coro
                if (i + 1) % 100 == 0:
                    print(f"Progress: {i+1}/{total} "
                          f"({len(self.failures)} failures)")

        print(f"\nComplete: {len(self.results)} success, "
              f"{len(self.failures)} failures")

        # Save failure list for retry
        with open("failures.json", "w") as f:
            json.dump(self.failures, f)
```

### 3.3 Voice Settings for Consistency

For audiobook-quality narration, these voice settings produce the best results:

```python
# Narration passages (most paragraphs)
NARRATION_SETTINGS = {
    "stability": 0.65,       # Higher = more consistent across paragraphs
    "similarity_boost": 0.85, # High similarity to maintain voice identity
    "style": 0.25,           # Moderate expressiveness
    "use_speaker_boost": True
}

# Dialogue passages (Jesus speaking, apostle discussions)
DIALOGUE_SETTINGS = {
    "stability": 0.5,        # Slightly more variable for natural speech
    "similarity_boost": 0.85,
    "style": 0.45,           # More expressive for emotional dialogue
    "use_speaker_boost": True
}

# Solemn/cosmic passages (descriptions of Paradise, Deity, etc.)
SOLEMN_SETTINGS = {
    "stability": 0.75,       # Very steady, measured
    "similarity_boost": 0.9,
    "style": 0.15,           # Subdued, reverential
    "use_speaker_boost": True
}
```

### 3.4 V3 Emotion Tags for Key Passages

ElevenLabs V3 supports inline audio tags. Use them strategically:

```python
def add_emotion_tags(text, context):
    """
    Add V3 emotion tags to text based on context.
    Use sparingly — over-tagging sounds unnatural.
    """
    # For Jesus' most important teachings
    if context == "jesus_teaching":
        return f"[warmly, with gentle authority] {text}"

    # For dramatic moments (crucifixion, betrayal)
    if context == "dramatic":
        return f"[solemnly] {text}"

    # For cosmic descriptions (Paradise, Havona)
    if context == "cosmic_awe":
        return f"[with reverence] {text}"

    # For dialogue attribution lines
    # "Jesus turned to Peter and said:"
    # Don't tag these — let the model handle naturally

    return text  # Default: no tags, let the model interpret
```

### 3.5 Output File Naming Convention

Match the existing pattern using globalId (the `id` field in API responses):

```
Pattern: eleven-v3-{voiceName}-{globalId}.mp3

Examples:
  eleven-v3-divine_counselor-1:0.0.1.mp3    (Foreword paragraph)
  eleven-v3-midwayer-4:121.0.1.mp3           (Paper 121 paragraph)
  eleven-v3-jesus-4:139.5.8.mp3              (Jesus dialogue)
```

This matches the existing convention: `tts-1-hd-nova-1:2.0.1.mp3`. The `generate-audio-manifest.ts` script already parses this format.

### 3.6 Resumability

The batch script must be resumable — generating 14,500+ files will take days. Design:
- Before each API call, check if output file already exists and has valid size
- Track progress in a `progress.json` with timestamps and status per paragraph
- On failure, log to `failures.json` with error details for retry
- Support `--retry-failures` flag to re-process only failed paragraphs
- Support `--paper=N` flag to generate a single paper (useful for testing voices)

---

## Phase 4: Quality Assurance

### 4.1 Automated Checks

```python
import subprocess

def validate_audio(filepath):
    """Check that generated MP3 is valid and reasonable."""
    # Check file exists and has content
    size = os.path.getsize(filepath)
    if size < 1000:  # Less than 1KB is suspicious
        return False, "File too small — likely empty/error"

    # Check duration with ffprobe
    result = subprocess.run(
        ["ffprobe", "-i", filepath, "-show_entries",
         "format=duration", "-v", "quiet", "-of", "csv=p=0"],
        capture_output=True, text=True
    )
    duration = float(result.stdout.strip())

    # Sanity check: most paragraphs should be 5-120 seconds
    if duration < 1.0:
        return False, f"Too short: {duration}s"
    if duration > 300.0:
        return False, f"Too long: {duration}s — check for errors"

    return True, f"OK ({duration:.1f}s)"
```

### 4.2 Manual Spot Check Strategy

Don't listen to all 17,000. Instead, sample strategically:

1. **First & last paragraph of every paper** (196 × 2 = 392 checks)
2. **Every voice's first appearance** (~25 checks)
3. **10 random Jesus dialogue paragraphs** from Papers 130-180
4. **5 random cosmic description paragraphs** from Papers 1-15
5. **All pronunciation-heavy paragraphs** (ones with 3+ unusual terms)

Total: ~500 manual listens out of 17,000 (~3%)

### 4.3 Cross-Paragraph Consistency Check

Listen to 3 consecutive paragraphs from the same paper to verify:
- Voice doesn't shift unexpectedly
- Pacing is similar between paragraphs
- No jarring tonal changes at paragraph boundaries
- Volume levels are consistent

---

## Cost Estimate

### Character count estimate:
- The Urantia Book: ~1,100,000 words ≈ 5,700,000 characters
- With regenerations (assume 10% failure rate): ~6,300,000 characters

### ElevenLabs pricing (as of March 2026):

| Plan | Monthly Cost | Characters Included | Overage Rate |
|------|-------------|--------------------|--------------|
| Creator | $22/mo | 100,000 | $0.30/1K chars |
| Pro | $99/mo | 500,000 | $0.24/1K chars |
| Scale | $330/mo | 2,000,000 | $0.18/1K chars |
| Business | $1,320/mo | 11,000,000 | Custom |

**Note:** V3 model uses more characters per generation than v2 models (roughly 2-3x the character cost). Check current pricing at `https://elevenlabs.io/pricing`.

### Recommended approach:
- **Scale plan ($330/month)** with 2M chars/month
- At V3 rates, expect to need ~3-4 months of generation
- **Total estimated cost: $1,000 - $2,000**
- Could do it in 1-2 months on Business plan for ~$1,320-$2,640

### Comparison:
- Human narrator for 60+ hours: $15,000 - $40,000+
- Current OpenAI tts-1-hd cost would be: ~$85 (but single voice, no expressiveness)

---

## Technical Requirements

### Runtime Decision: Bun/TypeScript (recommended) or Python

The existing codebase (API, seed scripts, manifest generator) is all Bun/TypeScript. Using the same stack means:
- Reuse existing types (`RawJsonNode`), JSON parsing, and manifest generation logic
- Scripts live alongside the API in `urantia-dev-api/scripts/`
- No second language runtime to manage

Python is an option if you prefer `aiohttp` for async HTTP or `pydub` for audio post-processing, but Bun's `fetch` and `Bun.write` handle the same workload.

### Dependencies (Bun/TS approach)
No new dependencies needed beyond what's already in the project. ElevenLabs API is plain REST — just `fetch()`.

### System requirements
- `ffmpeg` installed (for audio validation and any post-processing)
- ~15-20 GB disk space for all MP3 files
- Stable internet connection (~14,500 ElevenLabs API calls)

### Environment variables
```bash
export ELEVENLABS_API_KEY="your_key_here"
export OUTPUT_DIR="./output/eleven-v3"
```

---

## Suggested Script File Structure

Scripts live in the existing `urantia-dev-api/` project:

```
urantia-dev-api/
├── scripts/
│   ├── seed.ts                        # (existing) Seeds DB from JSON + audio manifest
│   ├── generate-audio-manifest.ts     # (existing) Scans MP3 dir → manifest JSON
│   ├── tts/
│   │   ├── config.ts                  # Voice mappings, ElevenLabs settings, author map
│   │   ├── 01-build-metadata.ts       # Read local JSONs, enrich with author + voice
│   │   ├── 02-detect-dialogue.ts      # Regex dialogue detection, speaker assignment
│   │   ├── 03-create-voices.ts        # Set up voices in ElevenLabs account
│   │   ├── 04-build-prondict.ts       # Create pronunciation dictionary via API
│   │   ├── 05-generate-audio.ts       # Main batch generation (concurrent, resumable)
│   │   ├── 06-validate.ts             # QA checks (file size, duration via ffprobe)
│   │   └── 07-upload.ts               # Upload to R2/CDN
│   └── ...
├── data/
│   ├── audio-manifest.json            # (existing) Current OpenAI audio manifest
│   ├── tts/
│   │   ├── paragraphs-enriched.json   # All paragraphs + author + speaker + voiceId
│   │   ├── voice-assignments.json     # Paragraph → voice mapping
│   │   ├── pronunciation.pls          # PLS pronunciation dictionary
│   │   └── failures.json              # Failed generations for retry
│   └── ...
├── output/
│   └── eleven-v3/                     # Generated MP3 files
└── /urantia-papers-json/              # (sibling dir) Source text — read directly
```

### Integration with existing infrastructure

After generation:
1. Run `generate-audio-manifest.ts` pointed at `output/eleven-v3/` to build a new manifest
2. Merge with existing `audio-manifest.json` (ElevenLabs audio coexists with OpenAI audio)
3. Run `seed.ts` to update the DB `audio` JSONB field
4. Upload MP3s to Cloudflare R2 (same bucket as existing audio at `cdn.urantia.dev/audio/eng/`)
5. New audio appears in API responses automatically under `audio["eleven-v3"]`

---

## Ideas & Improvements

### Paper-level topic labels for emotion context
Paper-level labels from the JSON (e.g., `["Spirituality", "Theology", "Cosmology"]`) can inform automatic emotion tagging. Map label sets to ElevenLabs V3 emotion hints:
- Papers with "Cosmology" → `cosmic_awe` settings (higher stability, lower style)
- Papers with "Spirituality" + Part IV → `jesus_teaching` settings (warmer, more expressive)
- Papers 53-54 (Lucifer Rebellion) → `dramatic` settings

### Pilot with one paper per voice before full batch
Before generating all 14,500 files, generate Paper 2 (Divine Counselor, 11 sections, ~80 paragraphs) as a complete pilot. Listen end-to-end to validate:
- Voice quality and consistency across consecutive paragraphs
- Pronunciation dictionary coverage
- Emotion tagging effectiveness
- Pacing and volume consistency

### Section-level audio concatenation
After generating individual paragraph MP3s, consider concatenating paragraphs within each section into section-level MP3s using `ffmpeg`. This enables:
- "Play full section" in reading apps
- Audiobook chapter export
- Better listening flow without per-paragraph silence gaps

### Cost optimization: batch by voice
ElevenLabs may have better throughput when generating many paragraphs for the same voice consecutively (API caching, connection reuse). Sort the generation queue by voice, not by paper order.

### Future: section/paper title audio
The existing audio includes title files (e.g., `tts-1-hd-nova-0:0.-.-.mp3` for section titles). Generate ElevenLabs equivalents for section and paper titles too — using the paper author's voice with a slightly more commanding tone.

---

## Key Decisions to Make Before Starting

1. **V3 vs Multilingual v2?** V3 is more expressive but higher latency and cost. For an audiobook project where latency doesn't matter, V3 is the clear choice.

2. **Multi-voice dialogue or single narrator?** Start with single narrator per paragraph (Approach A). Consider multi-voice for a Phase 2 on Papers 120-196.

3. **How to handle mixed narration+dialogue paragraphs?** Keep the author's voice but add V3 emotion tags for quoted speech sections.

4. **Seed-based generation for reproducibility?** Using `seed` parameter means regenerating a paragraph produces identical output. Useful for consistency but limits variety.

5. **Text source: RESOLVED.** The `api.urantia.dev` API has `GET /papers/{id}` which returns all paragraphs with full text. No scraping needed. 197 API calls gets you the entire book. The API also has full-text search (`POST /search`) and semantic search (`POST /search/semantic`) which are powerful tools for dialogue detection — you can search for "Jesus said", "Peter replied", etc. to find dialogue paragraphs efficiently.

6. **Voice selection method?** Browse the ElevenLabs library first. If nothing fits, use Voice Design API to create custom voices, or find reference audio clips for cloning.

---

## Quick Start for Claude Code

The first task is building the enriched metadata — no API calls needed:

```
1. Read all 197 JSON files from /urantia-papers-json/data/json/eng/
   Filter for type === "paragraph". Import the RawJsonNode type from
   src/types/node.ts for type safety.

2. Labels field: Already inspected — paper-level nodes have topic
   labels (Spirituality, Theology, etc.), paragraph nodes have [].
   Use paper-level labels for emotion tagging hints, not voice assignment.

3. Build paragraphs-enriched.json with all ~14,500 paragraphs:
   - paperAuthor (from PAPER_AUTHORS map in this doc)
   - detectedSpeaker (from dialogue detection regex)
   - voiceId (from VOICE_MAP)
   - emotionContext (from paper labels + content analysis)

4. For dialogue detection, combine two approaches:
   a. Regex on local text (fast, covers everything)
   b. API search for validation: POST /search with
      {"q": "Jesus said", "type": "phrase", "limit": 100}
      to cross-check dialogue detection accuracy

5. Output voice-assignments.json mapping every paragraph to a voice.
```

### Useful API patterns for spot-checking:

```bash
# Get paragraph with surrounding context (for dialogue flow analysis)
curl https://api.urantia.dev/paragraphs/139:5.8/context?window=5

# Search for dialogue paragraphs
curl -X POST https://api.urantia.dev/search \
  -H "Content-Type: application/json" \
  -d '{"q": "Jesus answered", "type": "phrase", "limit": 100}'

# Semantic search for thematic passages (helpful for emotion tagging)
curl -X POST https://api.urantia.dev/search/semantic \
  -H "Content-Type: application/json" \
  -d '{"q": "teachings about forgiveness", "limit": 20}'
```

### Audio file naming convention:

Existing files: `tts-1-hd-nova-{globalId}.mp3` (uses globalId like `1:2.0.1`)
New files: `eleven-v3-{voiceName}-{globalId}.mp3`

The `audio` JSONB field supports multiple models/voices side by side:
```json
"audio": {
  "tts-1-hd": {
    "nova": { "url": "https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-1:2.0.1.mp3", "format": "mp3" }
  },
  "eleven-v3": {
    "divine_counselor": { "url": "https://cdn.urantia.dev/audio/eng/paragraphs/divine_counselor/eleven-v3-divine_counselor-1:2.0.1.mp3", "format": "mp3" }
  }
}
```

New audio coexists alongside existing OpenAI narration — no replacement needed. Consumers can choose which model/voice to play.

### Existing infrastructure to reuse:

| What | Where | How to reuse |
|------|-------|-------------|
| Source text (all paragraphs) | `/urantia-papers-json/data/json/eng/*.json` | Read directly, no API needed |
| TypeScript types | `src/types/node.ts` (`RawJsonNode`) | Import for type-safe JSON parsing |
| Audio manifest generator | `scripts/generate-audio-manifest.ts` | Adapt for ElevenLabs output dir |
| DB seeder | `scripts/seed.ts` | Re-run after updating manifest |
| Existing MP3s for reference | `/original_audio_ub/` (16,413 files) | Compare quality, validate coverage |
| Audio manifest | `data/audio-manifest.json` | Merge new entries alongside existing |
| Embeddings | `data/embeddings.json` | Optional: cluster similar-tone passages |
