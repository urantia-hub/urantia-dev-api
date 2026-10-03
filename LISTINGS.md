# Where urantia.dev is listed

The one record of every directory, registry, and list that carries the Urantia Papers API or its MCP server. Each row was checked on the date shown.

**Keep it current.** When you submit somewhere, or a listing changes state, edit the row in the same change. Check a listing by loading its page, not from memory.

## Standard listing text

Use the same words everywhere, so the listings agree.

| Field | Value |
|---|---|
| Name | Urantia Papers (add "API" only where a directory needs it) |
| One line | Read and search the Urantia Papers by reference, keyword, or meaning, with named entities and Bible cross-references. |
| Short (80 characters) | Read and search the Urantia Papers by reference, keyword, or meaning. No key. |
| Author / company | Urantia.dev. Legal entity, when a form asks: Adams Technologies LLC |
| MCP server | `https://api.urantia.dev/mcp` (Streamable HTTP, no auth, 19 read-only tools) |
| OpenAPI spec | `https://api.urantia.dev/openapi.json` |
| Home | `https://urantia.dev` |
| Docs | `https://docs.urantia.dev` (MCP setup: `/mcp-servers`, API reference: `/api-reference/introduction`) |
| Icon | `https://api.urantia.dev/icon.png` (256 x 256 PNG) or `https://urantia.dev/favicon.svg` |
| Registry name | `dev.urantia/urantia-papers` |
| Privacy / terms | `https://docs.urantia.dev/privacy-policy`, `https://docs.urantia.dev/terms-of-service` |

Say "the Urantia Papers" for the text. "The Urantia Book" is the title of the 1955 published book.

## Live

| Where | Link | Notes | Checked |
|---|---|---|---|
| Official MCP Registry | `dev.urantia/urantia-papers` at https://registry.modelcontextprotocol.io | Version 1.1.0. Namespace is DNS-authenticated. Republish rules are in `CLAUDE.md` | 2026-10-03 |
| Glama, connector | https://glama.ai/mcp/connectors/dev.urantia/urantia-papers | A grades. `/.well-known/glama.json` claims the maintainer | 2026-10-03 |
| Glama, server | https://glama.ai/mcp/servers/urantia-hub/urantia-dev-api | Grade C, capped: hosted only, no local install. Do not add a stdio mode for the grade | 2026-10-03 |
| Smithery | https://smithery.ai/servers/urantiahub/urantia-papers | Badge is in `README.md` | 2026-10-03 |
| cursor.directory | https://cursor.directory/plugins/urantia-papers | Published from the plugin repo: MCP server plus the `urantia-research` skill. Verification badge requested | 2026-10-03 |
| Free Public APIs | https://www.freepublicapis.com/urantia-papers-api | A robot writes the description from the docs and tests the endpoints daily | 2026-10-03 |
| public-apis | https://github.com/public-apis/public-apis (Books) | Merged | 2026-10-03 |
| public-api-lists | https://github.com/public-api-lists/public-api-lists | PR #427, merged 2026-05-19 | 2026-10-03 |
| PulseMCP | https://www.pulsemcp.com/servers?q=urantia | Listed with old text ("The Urantia Book", author "Urantia Hub"). PulseMCP paused all changes on 2026-09-03 and re-reads the Registry when it reopens | 2026-10-03 |
| npm | `@urantia/api`, `@urantia/auth` | TypeScript SDKs, from the `urantia-dev-sdks` repo | 2026-10-03 |

## In review

| Where | Link | State | Since |
|---|---|---|---|
| Claude Connectors Directory | Manage at https://claude.ai/directory/manage, slug `urantia-papers` | In review. Questions go to mcp-review@anthropic.com | 2026-10-02 |
| awesome-remote-mcp-servers | https://github.com/punkpeye/awesome-remote-mcp-servers/pull/1026 | Open, CI green (`endpoint-ok`, `has-connector`), waits for a maintainer | 2026-10-03 |
| mcpservers.org | https://mcpservers.org/submit | Submitted on the free plan, category Search. Review within 2 weeks, answer by email | 2026-10-03 |
| APIs.io | https://apis.io/add/ | Submitted. A person reviews it; it lands in their next build | 2026-10-03 |
| mcp.so | https://mcp.so | Free-listing support ticket open. The paid path ($39) was skipped | 2026-10-02 |

## Stalled or closed

| Where | Link | What happened |
|---|---|---|
| APIs.guru | https://github.com/APIs-guru/openapi-directory/issues/2470 | Open since 2026-05-03 with no maintainer reply. They close about 60 add-API issues a year and 2,000 stay open. Logo URL updated 2026-10-03. No more effort planned |
| awesome-mcp-servers | https://github.com/punkpeye/awesome-mcp-servers/pull/5759 | Closed as inactive 2026-07-25. That list is for servers people install; remote-only servers belong in awesome-remote-mcp-servers (see above). Do not resubmit here |
| faith.tools | https://faith.tools | Submitted by email in May 2026. No listing found on 2026-10-03 |

## Not submitted, and why

| Where | Why |
|---|---|
| OpenAI ChatGPT / Codex plugins | Planned. Needs identity verification, a plugin ZIP, and a demo video. The domain check is ready: `/.well-known/openai-apps-challenge` serves the `OPENAI_APPS_CHALLENGE` secret |
| Postman Public API Network | Optional. Needs a public workspace built from the OpenAPI spec |
| Cursor built-in Marketplace | Curated by Cursor; its publish form mostly stopped taking direct submissions. The plugin repo has a `.cursor-plugin/plugin.json` manifest, so it is ready if that reopens |
| Unyly | Its form takes a GitHub repo and offers to host the server. Ours needs our database, so a copy cannot run |
| remote-mcp.com | Takes submissions as a GitHub pull request to `jaw9c/awesome-remote-mcp-servers` |
| RemoteMCPServer.ai | Site was down (error 530) on 2026-10-03 |
| RapidAPI, publicapi.dev | Paid or a poor fit for a free, open API |
| Show HN | Draft is ready. Post after the Claude directory listing is live |

## Mentions we did not submit

Found by a GitHub code search for `api.urantia.dev` on 2026-10-02. These read the official Registry or crawl on their own.

| Where | What it is |
|---|---|
| https://github.com/bendyline/gilde | MCP toolset catalog; carries our Registry entry |
| https://github.com/iskandarsulaili/fireROUTE | API gateway list |
| https://github.com/Twin-Sparks-Consulting-LLC/openagent-registry | Registry of agent-ready sites |
| https://github.com/shigeki7777/sasame-mcp-observatory | MCP observatory |
| https://github.com/Noirdua/KABBAK-API | An app that proxies `/integrations/urantia` to this API |

MCP monitors also call `/mcp` on a schedule (mcpbeat, SentinelOracle, rokmcp, and others). That traffic is health checks, not users.

## Related repos

- Plugin for Claude Code and Cursor: https://github.com/urantia-hub/urantia-papers-claude-code-plugin
- Registry manifest: `server.json` in this repo
