import { describe, expect, test } from "bun:test";
import { buildCollection, specOperations } from "../../scripts/postman-collection.ts";

const spec = {
	paths: {
		"/papers/{id}": {
			get: { summary: "Get a paper", description: "One paper.", tags: ["Papers"] },
		},
		"/search": {
			get: { summary: "Search (GET)", tags: ["Search"] },
			post: { summary: "Search", tags: ["Search"] },
		},
		"/feedback": { post: { summary: "Feedback", tags: ["Feedback"] } },
	},
};

const requests = [
	{ op: "get /papers/{id}", path: "/papers/2" },
	{ op: "get /search", path: "/search?q=Thought%20Adjuster&limit=2" },
	{ op: "post /search", path: "/search", body: { q: "Thought Adjuster" } },
];

describe("buildCollection", () => {
	test("makes one folder per tag, in spec order, and leaves out excluded operations", () => {
		const c = buildCollection(spec, requests);
		expect(c.item.map((f) => [f.name, f.item.length])).toEqual([
			["Papers", 1],
			["Search", 2],
		]);
		expect(specOperations(spec)).toContain("post /feedback");
	});

	test("writes the method, path, query, description, and JSON body", () => {
		const c = buildCollection(spec, requests);
		const [get, post] = c.item[1]?.item ?? [];
		expect(get?.request.url.raw).toBe("{{baseUrl}}/search?q=Thought%20Adjuster&limit=2");
		expect(get?.request.url.query).toEqual([
			{ key: "q", value: "Thought Adjuster" },
			{ key: "limit", value: "2" },
		]);
		expect(post?.request.method).toBe("POST");
		expect(JSON.parse(post?.request.body?.raw ?? "{}")).toEqual({ q: "Thought Adjuster" });
		expect(c.item[0]?.item[0]?.request.description).toBe("One paper.");
	});

	test("keeps the collection id, so Postman replaces the collection in place", () => {
		expect(buildCollection(spec, requests).info._postman_id).toBe(
			"3e09b679-4578-4ef6-82d3-2c16bf7e72e2",
		);
	});

	test("fails when an operation has no example request", () => {
		expect(() => buildCollection(spec, requests.slice(1))).toThrow(
			"No example request for: get /papers/{id}",
		);
	});
});
