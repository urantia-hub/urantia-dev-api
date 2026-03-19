import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

describe("Auth middleware — public routes passthrough", () => {
	it("GET / works without auth", async () => {
		const res = await get("/");
		expect(res.status).toBe(200);
	});

	it("GET /papers works without auth", async () => {
		const res = await get("/papers");
		expect(res.status).toBe(200);
	});

	it("GET /health works without auth", async () => {
		const res = await get("/health");
		expect(res.status).toBe(200);
	});

	it("GET /toc works without auth", async () => {
		const res = await get("/toc");
		expect(res.status).toBe(200);
	});
});

describe("Auth middleware — /me requires auth", () => {
	it("GET /me returns 401 without auth header", async () => {
		const res = await get("/me");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json.detail).toContain("Authentication required");
	});

	it("GET /me returns 401 with empty Bearer token", async () => {
		const res = await get("/me", { Authorization: "Bearer " });
		expect(res.status).toBe(401);
	});

	it("GET /me returns 401 with invalid JWT", async () => {
		const res = await get("/me", { Authorization: "Bearer not-a-valid-jwt" });
		expect(res.status).toBe(401);
	});

	it("GET /me returns 401 with malformed auth header (no Bearer prefix)", async () => {
		const res = await get("/me", { Authorization: "Token abc123" });
		expect(res.status).toBe(401);
	});

	it("returns RFC 9457 problem+json format", async () => {
		const res = await get("/me");
		expect(res.status).toBe(401);
		const json = await res.json();
		expect(json).toHaveProperty("type");
		expect(json).toHaveProperty("title");
		expect(json).toHaveProperty("status");
		expect(json).toHaveProperty("detail");
		expect(json.status).toBe(401);
		expect(json.title).toBe("Unauthorized");
	});
});
