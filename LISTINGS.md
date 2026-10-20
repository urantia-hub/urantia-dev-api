# Where urantia.dev is listed

The one record of every directory, registry, and list that carries the Urantia Papers API or its MCP server. Each row was checked on the date shown.

**Keep it current.** When you submit somewhere, or a listing changes state, edit the row in the same change. Check a listing by loading its page, not from memory.

## Standard listing text

Use the same words everywhere, so the listings agree.

| Field | Value |
|---|---|
| Name | Urantia Papers (add "API" only where a directory needs it) |
| One line | Read and search the Urantia Papers by reference, keyword, or meaning, with named entities and cross-references to texts of the world's religions. |
| One line, MCP-only listing | Read and search the Urantia Papers by reference, keyword, or meaning, with named entities and cross-references to texts of the world's religions. |
| Short (80 characters) | Read and search the Urantia Papers by reference, keyword, or meaning. No key. |
| Author / company | Urantia.dev. Legal entity, when a form asks: Adams Technologies LLC |
| MCP server | `https://api.urantia.dev/mcp` (Streamable HTTP, no auth, 26 read-only tools) |
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
| OpenAI plugin directory (ChatGPT and Codex) | https://chatgpt.com/plugins/plugin_asdk_app_6ac15926d5388191a941565bfaaa2a9a (manage at https://platform.openai.com/plugins) | Package 1.2.2 approved and published on 2026-10-20, under a verified individual identity. It still says 19 tools and lists only the Papers and the Bible: 1.3.2 (26 tools, the Bible and 21 other texts, built from plugin PR #9) was submitted on 2026-10-20 and is in review. It still carries the old demo link; the portal did not ask for a new one. Domain verified through `/.well-known/openai-apps-challenge`. Demo video (unlisted): https://youtu.be/-2WJRON0ZOE | 2026-10-20 |
| Official MCP Registry | `dev.urantia/urantia-papers` at https://registry.modelcontextprotocol.io | Version 1.3.0 (latest). Namespace is DNS-authenticated. Republish rules are in `CLAUDE.md` | 2026-10-19 |
| Glama, connector | https://glama.ai/mcp/connectors/dev.urantia/urantia-papers | A grades. `/.well-known/glama.json` claims the maintainer | 2026-10-10 |
| Glama, server | https://glama.ai/mcp/servers/urantia-hub/urantia-dev-api | Grade C, capped: hosted only, no local install. Do not add a stdio mode for the grade | 2026-10-03 |
| Smithery | https://smithery.ai/servers/urantiahub/urantia-papers | Badge is in `README.md` | 2026-10-10 |
| cursor.directory | https://cursor.directory/plugins/urantia-papers | Published from the plugin repo: MCP server plus the `urantia-research` skill. Verification badge requested | 2026-10-03 |
| Free Public APIs | https://www.freepublicapis.com/urantia-papers-api | A robot writes the description from the docs and tests the endpoints daily | 2026-10-10 |
| public-apis | https://github.com/public-apis/public-apis (Books) | Merged | 2026-10-03 |
| public-api-lists | https://github.com/public-api-lists/public-api-lists | PR #427, merged 2026-05-19 | 2026-10-03 |
| PulseMCP | https://www.pulsemcp.com/servers?q=urantia | Listed with old text ("The Urantia Book", author "Urantia Hub"). PulseMCP paused all changes on 2026-09-03 and re-reads the Registry when it reopens | 2026-10-10 |
| Postman Public API Network | https://www.postman.com/urantia-dev/urantia-papers (publisher: https://www.postman.com/urantia-dev) | Public workspace with 46 read-only requests in 15 folders, with Works, built by `scripts/postman-sync.ts --dry-run` and imported by hand on 2026-10-20 (no paid API key). Publisher verification requested 2026-10-04 | 2026-10-20 |
| mcpservers.org | https://mcpservers.org/servers/docs-urantia-dev-mcp-servers | Approved from the free submission of 2026-10-03. The listing links to docs.urantia.dev/mcp-servers. It shows 26 tools since its rescan | 2026-10-20 |
| Context7 | https://context7.com/urantia-hub/urantia-dev-docs | Added by Kelson on 2026-10-20 (Free plan, GitHub tab). Claimed and verified the same day: `url` and `public_key` in `context7.json` (docs #50). Settings are read from `context7.json`, not the dashboard | 2026-10-20 |
| APIs.io | https://apis.io/providers/urantia-papers/ | Live. Built from the public repo `api-evangelist/urantia-papers`. On 2026-10-05 the maintainer applied our correction by hand (their commit dced7ce) and closed PR #1 without a merge, which is their normal process: the spec (27 paths, 29 operations), the docs links, the MCP server with 19 tools, the catalog, and the robots line. The update is live since 2026-10-11 (his comment on PR #1). The re-score of 2026-10-09 moved the score from 6.1 to 40.5 of 100, and the agent score is 45. The page shows the MCP server with 19 tools and no account endpoints. Not applied: the Postman link, because no main docs page linked it; the docs home page and the API introduction link it now (docs #29). To ask for a change, open an issue on that repo | 2026-10-11 |
| awesome-remote-mcp-servers | https://github.com/punkpeye/awesome-remote-mcp-servers | PR #1026, merged 2026-10-08. The entry uses the standard listing text and the Glama connector badge | 2026-10-10 |
| npm | `@urantia/api`, `@urantia/auth` | TypeScript SDKs, from the `urantia-dev-sdks` repo | 2026-10-03 |

## In review

| Where | Link | State | Since |
|---|---|---|---|
| Claude Connectors Directory | Manage at https://claude.ai/directory/manage, slug `urantia-papers` | In review. On 2026-10-20 Kelson saved the standard one line, a description with the 26 tools and the 21 other texts, and notes on the public domain translations. The form says reviewers see a saved edit, so no resubmission. Questions go to mcp-review@anthropic.com | 2026-10-02 |
| Gemini CLI extensions gallery | https://geminicli.com/extensions/browse/ | No form. `gemini-extension.json` is at the root of the plugin repo and the repo has the topic `gemini-cli-extension` (plugin #6). Google's crawler lists it if it passes validation. Passed `gemini extensions validate` locally. Not listed on 2026-10-10. The repo meets the three listing rules (public, topic, manifest at the root). The gallery data file (`https://geminicli.com/extensions.json`) was last built on 2026-10-07, and many other repos tagged in the same weeks are also absent, so the delay is on the crawler side. To check: search that file for `urantia` | 2026-10-04 |
| mcp.so | https://mcp.so | Free-listing support ticket open. The paid path ($39) was skipped | 2026-10-02 |

## Pending updates (works round 3, 2026-10-18)

The MCP server has 26 tools (was 19) and serves the Bible and 21 other texts. Kelson approved this round on 2026-10-20. The Registry (1.3.0) and plugin PR #7 were already done. The OpenAI listing is live since 2026-10-20, so its update can go now; the Claude review is still open. Move each item into its row when it is done.

| Where | What to change | New text |
|---|---|---|
| OpenAI plugin directory | Wait for the review of 1.3.2 (submitted 2026-10-20), then publish it. If the reviewer asks for a new demo: the intro shows 26 tools, and Neg 2 asks for the Avesta | Neg 2 prompt: "Use the Urantia Papers plugin to quote what the Avesta says about truth." |
| APIs.io | Wait for the maintainer. Issue #3 on `api-evangelist/urantia-papers` asks for a refresh (opened 2026-10-20). The page shows 19 tools and no `/works`, and the score fell from 40.5 to 32.2 on 2026-10-17 | None |
| Smithery, Glama | They read the live server or the docs. Check that the tool count shows 26 after a rescan | None |
| PulseMCP | Re-reads the Registry when it reopens, so the Registry republish covers it | None |

## Stalled or closed

| Where | Link | What happened |
|---|---|---|
| APIs.guru | https://github.com/APIs-guru/openapi-directory/issues/2470 | Open since 2026-05-03 with no maintainer reply. They close about 60 add-API issues a year and 2,000 stay open. Logo URL updated 2026-10-03. No more effort planned |
| awesome-mcp-servers | https://github.com/punkpeye/awesome-mcp-servers/pull/5759 | Closed as inactive 2026-07-25. That list is for servers people install; remote-only servers belong in awesome-remote-mcp-servers (see above). Do not resubmit here |
| faith.tools | https://faith.tools | Submitted by email in May 2026. No listing found on 2026-10-03 |

## Not submitted, and why

| Where | Why |
|---|---|
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
