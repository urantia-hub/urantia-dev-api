// One real request for each public operation. The OpenAPI example capture and the
// Postman collection both use this list, so a new endpoint needs one entry here.
export type ExampleRequest = {
	op: string; // "get /papers/{id}", as in the spec
	path: string; // a real path with its query, such as "/papers/2"
	body?: unknown; // for POST requests
	capture?: boolean; // false: in Postman only (binary or very large responses)
};

export const EXAMPLE_REQUESTS: ExampleRequest[] = ([] = [
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
	{
		op: "post /search/semantic",
		path: "/search/semantic",
		body: { q: "what happens after death", limit: 2 },
	},
	{ op: "get /entities", path: "/entities?q=Melchizedek&limit=2" },
	{ op: "get /entities/{id}", path: "/entities/machiventa-melchizedek" },
	{
		op: "get /entities/{id}/paragraphs",
		path: "/entities/machiventa-melchizedek/paragraphs?limit=2",
	},
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
	{ op: "get /scriptures", path: "/scriptures" },
	{ op: "get /scriptures/{corpus}", path: "/scriptures/bhagavad-gita" },
	{ op: "get /scriptures/{corpus}/{ref}", path: "/scriptures/bhagavad-gita/2.47" },
	{
		op: "get /scriptures/{corpus}/{ref}/urantia-parallels",
		path: "/scriptures/bhagavad-gita/2.47/urantia-parallels",
	},
	{
		op: "post /scriptures/search/semantic",
		path: "/scriptures/search/semantic",
		body: { q: "hatred ceases by love", limit: 2, urantiaParallelLimit: 1 },
	},
	{
		op: "get /scriptures/insights/shared-currents",
		path: "/scriptures/insights/shared-currents?limit=2",
	},
	{ op: "get /scriptures/insights/far", path: "/scriptures/insights/far?paperId=108&limit=2" },
	{
		op: "get /scriptures/insights/pairs",
		path: "/scriptures/insights/pairs?excludeBible=true&limit=2",
	},
	{ op: "get /scriptures/insights/leans", path: "/scriptures/insights/leans?corpus=quran&limit=2" },
	{ op: "get /cite", path: "/cite?ref=2:5.1" },
	{
		op: "post /quotes/verify",
		path: "/quotes/verify",
		body: { text: "The Father loves us enough to bestow his life upon us.", ref: "2:5.1" },
	},
	{ op: "get /tools/openai", path: "/tools/openai" },
	{ op: "get /tools/anthropic", path: "/tools/anthropic" },
	{ op: "get /og/{ref}", path: "/og/2:5.1", capture: false },
	{ op: "get /embeddings/{ref}", path: "/embeddings/2:5.1?model=small", capture: false },
	{
		op: "get /embeddings/export",
		path: "/embeddings/export?paperId=1&model=small",
		capture: false,
	},
]);

// Operations left out on purpose. A public "Send" on POST /feedback would post real
// feedback to production.
export const EXCLUDED_OPS = new Set(["post /feedback"]);
