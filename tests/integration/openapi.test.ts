import { describe, expect, it } from "bun:test";
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
					{ "application/problem+json": { schema: { $ref: "#/components/schemas/ProblemDetails" } } },
				]);
			}
		}
		expect(errors).toBeGreaterThan(100);
	});

	it("documents the rate limit on every operation", async () => {
		const spec = await loadSpec();
		for (const { key, op } of operations(spec)) {
			expect([key, Object.keys(op.responses).includes("429")]).toEqual([key, true]);
			for (const response of Object.values<Loose>(op.responses)) {
				expect(Object.keys(response.headers)).toEqual(
					expect.arrayContaining(["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"]),
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
		expect(spec.paths["/paragraphs/{ref}"].get.responses["200"].content["application/json"].example.data.standardReferenceId).toBe("2:5.1");
		expect(spec.paths["/og/{ref}"].get.parameters[0].example).toBe("2:5.1");
		expect(spec.paths["/me/bookmarks"].post.requestBody.content["application/json"].example).toEqual({
			ref: "2:5.1",
			category: "Love",
		});
	});

	it("marks the signed-in operations, and they refuse a request with no token", async () => {
		const spec = await loadSpec();
		expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
		const flow = spec.components.securitySchemes.oauth2.flows.authorizationCode;
		expect(flow.tokenUrl).toBe("https://api.urantia.dev/auth/token");
		expect(Object.keys(flow.scopes)).toEqual([
			"profile",
			"bookmarks",
			"notes",
			"reading-progress",
			"preferences",
			"app-data",
		]);

		const secured = operations(spec).filter(({ op }) => op.security);
		expect(secured.length).toBeGreaterThan(20);
		for (const { key, path, method } of secured) {
			const url = path.replace(/\{[^}]+\}/g, "00000000-0000-0000-0000-000000000000");
			const res = await app.request(url, {
				method: method.toUpperCase(),
				headers: { "Content-Type": "application/json", ...TEST_IP },
				body: method === "get" || method === "delete" ? undefined : "{}",
			});
			// A route with a body can reject the empty body first, with 400.
			const allowed = method === "get" || method === "delete" ? [401] : [400, 401];
			expect([key, allowed.includes(res.status)]).toEqual([key, true]);
		}
	});

	it("leaves the public operations without a security requirement", async () => {
		const spec = await loadSpec();
		for (const { key, path, op } of operations(spec)) {
			if (path.startsWith("/me") || path.startsWith("/auth")) continue;
			expect([key, op.security]).toEqual([key, undefined]);
		}
		expect(spec.paths["/auth/token"].post.security).toBeUndefined();
		expect(spec.security).toEqual([]);
	});
});
