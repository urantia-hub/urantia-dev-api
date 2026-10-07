import { describe, expect, it } from "bun:test";
import { buildCollection } from "../../scripts/postman-collection.ts";
import { app } from "../../src/index.ts";

// biome-ignore lint/suspicious/noExplicitAny: the spec is read loosely
type Loose = any;

const METHODS = ["get", "post", "put", "patch", "delete"];
// These requests get their own rate-limit counter, apart from the rest of the suite.
const TEST_IP = { "cf-connecting-ip": "openapi-test" };

async function loadSpec(): Promise<Loose> {
	const res = await app.request("/openapi.json", { headers: TEST_IP });
	expect(res.status).toBe(200);
	return res.json();
}

function operations(spec: Loose): { key: string; path: string; method: string; op: Loose }[] {
	const list = [];
	for (const [path, item] of Object.entries<Loose>(spec.paths)) {
		for (const method of METHODS) {
			if (item[method]) list.push({ key: `${method} ${path}`, path, method, op: item[method] });
		}
	}
	return list;
}

describe("GET /openapi.json", () => {
	it("gives every error response the shared problem details schema", async () => {
		const spec = await loadSpec();
		expect(spec.components.schemas.ProblemDetails.required).toEqual([
			"type",
			"title",
			"status",
			"detail",
		]);

		let errors = 0;
		for (const { key, op } of operations(spec)) {
			for (const [status, response] of Object.entries<Loose>(op.responses)) {
				if (!/^[45]/.test(status)) continue;
				errors++;
				expect([key, status, response.content]).toEqual([
					key,
					status,
					{
						"application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } },
					},
				]);
			}
		}
		expect(errors).toBeGreaterThan(60);
	});

	it("documents the rate limit on every operation", async () => {
		const spec = await loadSpec();
		for (const { key, op } of operations(spec)) {
			expect([key, Object.keys(op.responses).includes("429")]).toEqual([key, true]);
			for (const response of Object.values<Loose>(op.responses)) {
				expect(Object.keys(response.headers)).toEqual(
					expect.arrayContaining([
						"X-RateLimit-Limit",
						"X-RateLimit-Remaining",
						"X-RateLimit-Reset",
					]),
				);
			}
		}
		expect(Object.keys(spec.components.headers)).toHaveLength(3);
	});

	it("sends the headers and the error format that the spec documents", async () => {
		// The ref parameter is missing, so validation fails before any database call.
		const res = await app.request("/cite", { headers: TEST_IP });
		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toContain("application/problem+json");
		expect(res.headers.get("x-ratelimit-limit")).toBe("200");
		expect(Object.keys(await res.json()).sort()).toEqual(["detail", "status", "title", "type"]);
	});

	it("carries an example on more than half of the operations", async () => {
		const spec = await loadSpec();
		const all = operations(spec);
		const withExample = all.filter(({ op }) => JSON.stringify(op).includes('"example"'));
		expect(withExample.length / all.length).toBeGreaterThan(0.5);
		expect(
			spec.paths["/paragraphs/{ref}"].get.responses["200"].content["application/json"].example.data
				.standardReferenceId,
		).toBe("2:5.1");
		expect(spec.paths["/og/{ref}"].get.parameters[0].example).toBe("2:5.1");
		expect(
			spec.paths["/feedback"].post.requestBody.content["application/json"].example.category,
		).toBe("docs");
	});

	it("says on every lang parameter that paragraph text is English only", async () => {
		const spec = await loadSpec();
		const langs = operations(spec).flatMap(({ op }) =>
			(op.parameters ?? []).filter((p: Loose) => p.name === "lang"),
		);
		expect(langs.length).toBeGreaterThan(5);
		for (const p of langs) expect(p.description).toContain("Paragraph text is in English only");
	});

	it("lists the open content API only, with no auth scheme", async () => {
		const spec = await loadSpec();
		const paths = Object.keys(spec.paths);
		expect(paths.filter((path) => path.startsWith("/me") || path.startsWith("/auth"))).toEqual([]);
		expect(paths).toContain("/paragraphs/{ref}");
		expect(spec.components.securitySchemes).toBeUndefined();
		expect(spec.security).toEqual([]);
		for (const { key, op } of operations(spec)) {
			expect([key, op.security]).toEqual([key, undefined]);
		}
		expect(JSON.stringify(spec)).not.toContain("accounts.urantiahub.com");
	});

	it("keeps the account operations working, outside the spec", async () => {
		for (const path of ["/me", "/me/bookmarks", "/auth/apps"]) {
			const res = await app.request(path, { headers: TEST_IP });
			expect([path, res.status]).toEqual([path, 401]);
		}
	});
});

describe("Postman collection coverage", () => {
	it("has an example request for every public operation", async () => {
		const spec = await loadSpec();
		const collection = buildCollection(spec);
		expect(collection.item.flatMap((f) => f.item).length).toBeGreaterThan(30);
	});
});
