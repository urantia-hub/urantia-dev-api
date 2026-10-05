const API = "https://api.urantia.dev";

/** The RFC 9727 API catalog: one entry for the REST API and one for the MCP server. */
export function apiCatalog() {
	return {
		linkset: [
			{
				anchor: API,
				"service-desc": [{ href: `${API}/openapi.json`, type: "application/json" }],
				"service-doc": [
					{ href: "https://docs.urantia.dev/api-reference/introduction", type: "text/html" },
				],
				status: [{ href: "https://status.urantia.dev", type: "text/html" }],
			},
			{
				anchor: `${API}/mcp`,
				"service-doc": [{ href: "https://docs.urantia.dev/mcp-servers", type: "text/html" }],
				"service-meta": [
					{ href: `${API}/.well-known/mcp/server-card.json`, type: "application/json" },
				],
			},
		],
	};
}

export const API_CATALOG_TYPE =
	'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';
