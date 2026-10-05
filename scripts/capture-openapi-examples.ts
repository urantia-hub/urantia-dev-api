// Captures real responses from the API and writes them as OpenAPI examples.
// Run: bun scripts/capture-openapi-examples.ts [baseUrl]
const BASE = process.argv[2] ?? "https://api.urantia.dev";
const OUT = new URL("../src/lib/openapi-examples.json", import.meta.url);
const MAX_ITEMS = 2;

type Capture = { op: string; path: string; body?: unknown };

const CAPTURES: Capture[] = [
	{ op: "get /toc", path: "/toc" },
	{ op: "get /papers", path: "/papers" },
	{ op: "get /papers/{id}", path: "/papers/2" },
	{ op: "get /papers/{id}/sections", path: "/papers/2/sections" },
	{ op: "get /paragraphs/random", path: "/paragraphs/random" },
	{ op: "get /paragraphs/{ref}", path: "/paragraphs/2:5.1" },
	{ op: "get /paragraphs/{ref}/context", path: "/paragraphs/2:5.10/context?window=1" },
	{ op: "get /search", path: "/search?q=Thought%20Adjuster&limit=2" },
	{ op: "post /search", path: "/search", body: { q: "Thought Adjuster", limit: 2 } },
	{ op: "get /search/semantic", path: "/search/semantic?q=what%20happens%20after%20death&limit=2" },
	{ op: "post /search/semantic", path: "/search/semantic", body: { q: "what happens after death", limit: 2 } },
	{ op: "get /entities", path: "/entities?q=Melchizedek&limit=2" },
	{ op: "get /entities/{id}", path: "/entities/machiventa-melchizedek" },
	{ op: "get /entities/{id}/paragraphs", path: "/entities/machiventa-melchizedek/paragraphs?limit=2" },
	{ op: "get /languages", path: "/languages" },
	{ op: "get /audio/{ref}", path: "/audio/2:5.1" },
	{ op: "get /bible/books", path: "/bible/books" },
	{ op: "get /bible/{bookCode}", path: "/bible/MAT" },
	{ op: "get /bible/{bookCode}/{chapter}", path: "/bible/MAT/5" },
	{ op: "get /bible/{bookCode}/{chapter}/{verse}", path: "/bible/MAT/5/3" },
	{
		op: "get /bible/{bookCode}/{chapter}/{verse}/urantia-parallels",
		path: "/bible/MAT/5/3/urantia-parallels",
	},
	{
		op: "post /bible/search/semantic",
		path: "/bible/search/semantic",
		body: { q: "blessed are the poor in spirit", limit: 2, urantiaParallelLimit: 1 },
	},
	{ op: "get /cite", path: "/cite?ref=2:5.1" },
	{ op: "get /tools/openai", path: "/tools/openai" },
	{ op: "get /tools/anthropic", path: "/tools/anthropic" },
];

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
