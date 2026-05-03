# Dockerfile for local development and self-hosting.
#
# Canonical production deploys to Cloudflare Workers (see scripts/deploy.sh and
# wrangler.toml). This image is for anyone who wants to run the API outside of
# Cloudflare — local Docker dev, on-prem deploys, container-based CI, or third-
# party MCP introspection (Glama, etc.). The server boots without a real
# database (tools/list reads only registered tool metadata in src/routes/mcp.ts),
# but actual tool calls require DATABASE_URL plus the other env vars listed in
# CLAUDE.md.

FROM oven/bun:1.3-alpine

WORKDIR /app

# Install dependencies first so this layer is cached when only source changes.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Copy the rest of the source.
COPY . .

# The Worker reads PORT from env (defaults to 3000).
ENV PORT=3000
EXPOSE 3000

# Sensible dummies for env vars that are read at handler time (not boot time).
# Glama can override these in its build admin if it wants real introspection.
ENV DATABASE_URL=postgresql://dummy:dummy@localhost:5432/dummy
ENV APP_JWT_SECRET=glama-introspection-dummy-secret
ENV ADMIN_USER_IDS=

CMD ["bun", "run", "start"]
