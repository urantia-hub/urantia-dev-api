#!/bin/sh
# Glama MCP server introspection entrypoint.
#
# Glama's harness wants a stdio MCP server. Our server speaks streamable HTTP
# on Cloudflare Workers in production, and locally on port 3000. This script
# starts the HTTP server in the background, waits for it to bind, and then
# runs mcp-proxy as an HTTP-to-stdio bridge so the harness can introspect
# tools/list and the rest of the MCP surface.

set -e

# Start the HTTP server in background.
bun run start &
SERVER_PID=$!

# Wait for the server to bind port 3000. Plain `sleep` since trixie-slim
# doesn't include `nc` and we don't want to add another apt-get layer.
sleep 5

# Bridge stdio (in/out from Glama's harness) to our HTTP endpoint.
# If the --transport flag form below isn't right for this mcp-proxy version,
# the error log will say so and we adjust.
exec mcp-proxy --transport streamable-http http://localhost:3000/mcp
