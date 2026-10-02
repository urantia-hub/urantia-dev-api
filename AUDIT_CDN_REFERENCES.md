# CDN Reference Audit Results

## Investigation Date
2026-10-02

## Issue Reported
Live audit found `https://cdn.openurantia.com` returning HTTP 530 on audio MP3 files.

## Current Status
Resolved: Cloudflare now redirects `cdn.openurantia.com` → `https://cdn.urantia.dev` (301, path and query preserved). The redirect lives in Cloudflare only; no code change in this repo was required. The sections below are the original investigation, kept for historical context.

## Findings

### 1. Current Code State (urantia-dev-api)
- ✅ **No references to `cdn.openurantia.com` found in code or git history**
- ✅ **No references to `openurantia.com` found in code or git history**
- ✅ **Current manifest** (`data/audio-manifest.json`) uses correct `cdn.urantia.dev` URLs exclusively
- ⚠️ **Legacy constant** in `scripts/generate-audio-manifest.ts` was pointing to `audio.urantia.dev` (now fixed)
- ⚠️ **Outdated documentation** in design plans referenced `audio.urantia.dev` (now fixed)

### 2. Correct CDN Infrastructure (per CLAUDE.md)
Audio assets should use `cdn.urantia.dev`, NOT `audio.urantia.dev`:

- **Paragraph audio**: `cdn.urantia.dev/audio/eng/paragraphs/{voice}/{model}-{voice}-{globalId}.mp3`
- **Paper audio**: `cdn.urantia.dev/audio/eng/papers/{paperId}.mp3`
- **Part audio**: `cdn.urantia.dev/audio/eng/parts/{model}-{voice}-Part{n}.mp3`

**Note**: `audio.urantia.dev` is a frozen legacy snapshot with only nova files. It should not be used.

### 3. Changes Made
- Updated `LEGACY_CDN_BASE` constant from `https://audio.urantia.dev` to `https://cdn.urantia.dev/audio/eng`
- Updated design documentation to reflect correct CDN host
- All changes preventative - no broken URLs found in current manifest

### 4. Potential External Sources of `cdn.openurantia.com`

Since no code references were found in urantia-dev-api, the 530 error may originate from:

1. **DNS/Cloudflare Configuration**
   - `cdn.openurantia.com` may be a DNS record pointing to defunct infrastructure
   - Recommendation: Audit Cloudflare DNS records for `openurantia.com` zone
   - Consider: Redirect rule from `cdn.openurantia.com` → `cdn.urantia.dev`

2. **Frontend Applications**
   - Check `urantia-hub` frontend repo (if exists)
   - Check any React/Next.js applications consuming the API
   - Search for hardcoded CDN URLs in client code

3. **SDK Code**
   - Check `@urantia/api` SDK (v0.1.0)
   - Check `@urantia/auth` SDK (v0.1.0)
   - Verify no hardcoded CDN paths in published packages

4. **External Documentation**
   - README files in other repos
   - API documentation sites
   - Integration guides
   - Blog posts or tutorials

5. **Cached Data**
   - Old API responses cached in browsers/CDNs
   - Historical data in client applications
   - Bookmarked URLs from users

## Verification Steps Needed

### API Response Check
```bash
# Test current API audio endpoint
curl -s https://api.urantia.dev/audio/0:0.0.1 | jq '.data.audio'

# Verify URLs use cdn.urantia.dev
curl -s https://api.urantia.dev/paragraphs/0:0.0.1 | jq '.data.audio'
```

### Database Check
```bash
# Query production database for any audio.urantia.dev or openurantia.com references
psql "$DATABASE_URL" -c "SELECT globalId, audio::text FROM paragraphs WHERE audio::text LIKE '%audio.urantia.dev%' LIMIT 10;"
psql "$DATABASE_URL" -c "SELECT globalId, audio::text FROM paragraphs WHERE audio::text LIKE '%openurantia.com%' LIMIT 10;"
```

## Recommended Actions

### Immediate (Code)
- [x] Fix `LEGACY_CDN_BASE` constant in manifest generator
- [x] Update documentation to reference correct CDN host
- [ ] Audit other urantia-hub repos for `cdn.openurantia.com` references
- [ ] Check SDK source code for hardcoded CDN paths

### Infrastructure (Requires Cloudflare Access)
If `cdn.openurantia.com` exists in DNS:

1. **Option A: Redirect Rule** (Recommended if traffic exists)
   ```
   Source: cdn.openurantia.com/*
   Target: https://cdn.urantia.dev/$1
   Status: 301 (Permanent Redirect)
   ```

2. **Option B: Remove DNS Record** (If no legitimate traffic)
   - Delete A/CNAME record for `cdn.openurantia.com`
   - May break existing bookmarks/links

3. **Verification**
   - Test sample MP3 URL that returned 530
   - Monitor error logs for origin of 530 responses
   - Check if `openurantia.com` zone should be retired entirely

## Testing URLs
Once changes are deployed, test these URLs should work:
```
https://cdn.urantia.dev/audio/eng/paragraphs/nova/tts-1-hd-nova-0:0.0.1.mp3
https://cdn.urantia.dev/audio/eng/papers/0.mp3
```

These should NOT be used (legacy, frozen, or broken):
```
https://audio.urantia.dev/* (frozen snapshot, nova only)
https://cdn.openurantia.com/* (returned 530 at time of audit; now 301s to cdn.urantia.dev, but use cdn.urantia.dev directly)
```
