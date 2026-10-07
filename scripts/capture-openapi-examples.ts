// Captures real responses from the API and writes them as OpenAPI examples.
// Run: bun scripts/capture-openapi-examples.ts [baseUrl]
import { EXAMPLE_REQUESTS } from "./example-requests.ts";

const BASE = process.argv[2] ?? "https://api.urantia.dev";
const OUT = new URL("../src/lib/openapi-examples.json", import.meta.url);
const MAX_ITEMS = 2;

const CAPTURES = EXAMPLE_REQUESTS.filter((r) => r.capture !== false);

// Keeps every field and every string whole, and cuts each list to its first items.
function trim(value: unknown): unknown {
	if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map(trim);
	if (value && typeof value === "object") {
		return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trim(v)]));
	}
	return value;
}

const examples: Record<string, { request?: unknown; response: unknown }> = {};

for (const capture of CAPTURES) {
	const res = await fetch(`${BASE}${capture.path}`, {
		method: capture.body ? "POST" : "GET",
		headers: {
			"Content-Type": "application/json",
			"User-Agent": "urantia-dev-api/capture-openapi-examples",
		},
		body: capture.body ? JSON.stringify(capture.body) : undefined,
	});
	if (res.status !== 200) {
		throw new Error(`${capture.op} (${capture.path}) returned ${res.status}`);
	}
	examples[capture.op] = { request: capture.body, response: trim(await res.json()) };
	await new Promise((resolve) => setTimeout(resolve, 400));
}

await Bun.write(OUT, `${JSON.stringify(examples, null, "\t")}\n`);
console.log(`Wrote ${Object.keys(examples).length} examples`);
