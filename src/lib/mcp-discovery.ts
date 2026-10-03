/**
 * MCP discovery documents served under /.well-known.
 *
 * They describe this API's own MCP server so a client that probes the host
 * finds it without the docs. There is no ratified standard yet; the shapes
 * follow the manifest and server-card drafts that other hosts serve today.
 *
 * The card carries no tool list on purpose. A client gets the live list from
 * the server itself (tools/list), so nothing here can drift from it.
 */

import { MCP_ICONS } from "./brand-icon.ts";

const MCP_URL = "https://api.urantia.dev/mcp";
const TRANSPORT = "streamable-http";
// Keep in step with `version` in server.json (the MCP Registry entry).
const VERSION = "1.1.0";

const NAME = "Urantia Papers";
const DESCRIPTION =
	"API and MCP server for the Urantia Papers. Search the text, look up any paragraph, and follow cross-references. Free, with no key.";

/** /.well-known/mcp.json and /.well-known/mcp */
export function mcpManifest() {
	return {
		version: VERSION,
		transport: TRANSPORT,
		url: MCP_URL,
		servers: [
			{
				name: "urantia-papers",
				url: MCP_URL,
				transport: TRANSPORT,
				authentication: "none",
			},
		],
	};
}

/** /.well-known/mcp/server-card.json */
export function mcpServerCard() {
	return {
		name: NAME,
		description: DESCRIPTION,
		version: VERSION,
		serverInfo: { name: NAME, version: VERSION, icons: MCP_ICONS },
		icons: MCP_ICONS,
		url: MCP_URL,
		transport: TRANSPORT,
		authentication: "none",
		capabilities: { tools: true, resources: true, prompts: true },
		// urantia.dev redirects this path to the docs host, so the link holds if the docs move.
		documentation: "https://urantia.dev/mcp-servers",
		openapi: "https://api.urantia.dev/openapi.json",
	};
}
