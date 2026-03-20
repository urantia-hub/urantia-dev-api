# Contributing

## Prerequisites

- [Bun](https://bun.sh/)
- Supabase Postgres database

## Setup

```bash
bun install
cp .env.example .env
# Fill in your .env values
bun run dev
```

## Running Tests

```bash
bun test
```

There are 142 integration tests covering all API endpoints.

## Submitting Changes

1. Fork the repo
2. Create a feature branch (`git checkout -b my-feature`)
3. Make your changes
4. Run `bun test` and `bun run typecheck` to verify nothing is broken
5. Open a pull request against `main`

## Code Style

This project uses [Biome](https://biomejs.dev/) for linting. Run `bun run lint` to check.
