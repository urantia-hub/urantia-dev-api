#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-https://api.urantia.dev}"

echo "→ Deploying to Cloudflare Workers..."
bunx wrangler deploy

echo "→ Waiting for deploy to propagate..."
sleep 3

echo "→ Health check..."
if curl -sSf --max-time 10 "$API_URL/health" > /dev/null; then
	echo "  ok"
else
	echo "  ! health check failed (deploy itself succeeded)"
fi

# Warms the Worker isolate, the Hyperdrive pool, and populates the
# unfiltered count cache in SEARCH_CACHE KV. Without this, the first
# real user query after deploy pays ~2s cold tax; with it, the floor
# is ~300ms because count(*) is already cached.
echo "→ Warming semantic search cache..."
if curl -sS --max-time 30 "$API_URL/search/semantic?q=warmup&limit=1" > /dev/null; then
	echo "  ok"
else
	echo "  ! warmup failed (deploy itself succeeded)"
fi

echo "→ Deploy complete."
