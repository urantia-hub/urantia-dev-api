import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import { assertProblemShape } from "../helpers/shapes.ts";

// workers-og uses WASM internally that may throw errors in Bun's test runtime
// (it's designed for Cloudflare Workers). We test routing, status codes, and
// error handling — image rendering is verified manually via `curl /og/1:0.1`.

describe("GET /og/:ref", () => {
	it("returns 404 for invalid ref", async () => {
		const res = await get("/og/not-a-ref");
		expect(res.status).toBe(404);
		const json = await res.json();
		assertProblemShape(json);
	});

	it("returns 404 for non-existent ref", async () => {
		const res = await get("/og/999:999.999");
		expect(res.status).toBe(404);
		const json = await res.json();
		assertProblemShape(json);
	});
});
