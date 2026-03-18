import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import { assertProblemShape } from "../helpers/shapes.ts";

describe("GET /embeddings/:ref", () => {
	it("returns embedding with 1536 dimensions", async () => {
		const res = await get("/embeddings/1:0.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.ref).toBeString();
		expect(data.model).toBe("text-embedding-3-small");
		expect(data.dimensions).toBe(1536);
		expect(data.embedding).toBeArray();
		expect(data.embedding.length).toBe(1536);
	});

	it("returns 404 for non-existent ref", async () => {
		const res = await get("/embeddings/999:999.999");
		expect(res.status).toBe(404);
		const json = await res.json();
		assertProblemShape(json);
	});

	it("returns 404 for invalid ref", async () => {
		const res = await get("/embeddings/bad-ref");
		expect(res.status).toBe(404);
	});
});

describe("GET /embeddings/export", () => {
	it("returns JSONL by default with paperId filter", async () => {
		const res = await get("/embeddings/export?paperId=1");
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("application/x-ndjson");
		const text = await res.text();
		const lines = text.trim().split("\n");
		expect(lines.length).toBeGreaterThan(0);
		const first = JSON.parse(lines[0]!);
		expect(first.ref).toBeString();
		expect(first.embedding).toBeArray();
	});

	it("returns JSON when format=json", async () => {
		const res = await get("/embeddings/export?paperId=1&format=json");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toBeArray();
		expect(data.length).toBeGreaterThan(0);
		expect(data[0].ref).toBeString();
		expect(data[0].embedding).toBeArray();
	});

	it("returns 400 when paperId is missing", async () => {
		const res = await get("/embeddings/export");
		expect(res.status).toBe(400);
	});
});
