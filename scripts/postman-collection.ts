// Builds the public Postman collection from the OpenAPI spec and the example requests.
import { EXAMPLE_REQUESTS, EXCLUDED_OPS, type ExampleRequest } from "./example-requests.ts";

// Keep this id: the published collection is replaced in place under it.
export const COLLECTION_ID = "3e09b679-4578-4ef6-82d3-2c16bf7e72e2";

const DESCRIPTION = `Read and search the Urantia Papers by reference, keyword, or meaning, with named entities, narration audio, cross-references to the World English Bible and to public domain texts of the world's religions, and quote verification. No key or account is needed. Every request in this collection is read-only and runs as is.

Docs: https://docs.urantia.dev
OpenAPI: https://api.urantia.dev/openapi.json
MCP server: https://api.urantia.dev/mcp

This collection is rebuilt from the live OpenAPI spec after each API release.`;

type Operation = { summary?: string; description?: string; tags?: string[] };
type Spec = { paths: Record<string, Record<string, Operation>> };

const METHODS = ["get", "post", "put", "patch", "delete"];

/** Every operation in the spec that the collection must cover. */
export function specOperations(spec: Spec): string[] {
	return Object.entries(spec.paths).flatMap(([path, ops]) =>
		Object.keys(ops)
			.filter((m) => METHODS.includes(m))
			.map((m) => `${m} ${path}`),
	);
}

function item(spec: Spec, r: ExampleRequest) {
	const [method, path] = r.op.split(" ") as [string, string];
	const op = spec.paths[path]?.[method] as Operation;
	const [pathname, search = ""] = r.path.split("?");
	const query = [...new URLSearchParams(search)].map(([key, value]) => ({ key, value }));
	return {
		name: op.summary ?? r.op,
		request: {
			method: method.toUpperCase(),
			header: r.body === undefined ? [] : [{ key: "Content-Type", value: "application/json" }],
			url: {
				raw: `{{baseUrl}}${r.path}`,
				host: ["{{baseUrl}}"],
				path: (pathname as string).split("/").filter(Boolean),
				...(query.length ? { query } : {}),
			},
			description: op.description ?? "",
			...(r.body === undefined
				? {}
				: {
						body: {
							mode: "raw",
							raw: JSON.stringify(r.body, null, 2),
							options: { raw: { language: "json" } },
						},
					}),
		},
	};
}

/**
 * The collection, one folder per spec tag in spec order. Throws when an operation in
 * the spec has no example request, so the collection cannot fall behind the API.
 */
export function buildCollection(spec: Spec, requests: ExampleRequest[] = EXAMPLE_REQUESTS) {
	const ops = specOperations(spec);
	const byOp = new Map(requests.map((r) => [r.op, r]));
	const missing = ops.filter((o) => !byOp.has(o) && !EXCLUDED_OPS.has(o));
	if (missing.length) throw new Error(`No example request for: ${missing.join(", ")}`);
	const folders = new Map<string, ReturnType<typeof item>[]>();
	for (const op of ops) {
		const r = byOp.get(op);
		if (!r || EXCLUDED_OPS.has(op)) continue;
		const [method, path] = op.split(" ") as [string, string];
		const tag = spec.paths[path]?.[method]?.tags?.[0] ?? "Other";
		folders.set(tag, [...(folders.get(tag) ?? []), item(spec, r)]);
	}
	return {
		info: {
			_postman_id: COLLECTION_ID,
			name: "Urantia Papers API",
			description: DESCRIPTION,
			schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
		},
		item: [...folders].map(([name, items]) => ({ name, item: items })),
		variable: [{ key: "baseUrl", value: "https://api.urantia.dev", type: "string" }],
	};
}
