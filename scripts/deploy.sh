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

# The public Postman collection follows the live spec. The workflow does the work;
# a failure here never fails the deploy.
echo "→ Starting the Postman sync..."
if command -v gh > /dev/null && gh workflow run postman-sync.yml -R urantia-hub/urantia-dev-api > /dev/null 2>&1; then
	echo "  started (gh run list -R urantia-hub/urantia-dev-api -w postman-sync.yml)"
else
	echo "  ! could not start it; run: gh workflow run postman-sync.yml -R urantia-hub/urantia-dev-api"
fi

echo "→ Deploy complete."
