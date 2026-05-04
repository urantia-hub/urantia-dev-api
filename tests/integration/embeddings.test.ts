import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import { assertProblemShape } from "../helpers/shapes.ts";

describe("GET /embeddings/:ref", () => {
	it("defaults to text-embedding-3-large (3072-d)", async () => {
		const res = await get("/embeddings/1:0.1");
		expect(res.status).toBe(200);
		expect(res.headers.get("x-embedding-model")).toBe("text-embedding-3-large");
		const { data } = await res.json();
		expect(data.standardReferenceId).toBeString();
		expect(data.model).toBe("text-embedding-3-large");
		expect(data.dimensions).toBe(3072);
		expect(data.embedding).toBeArray();
		expect(data.embedding.length).toBe(3072);
	});

	it("returns the 1536-d small model when ?model=small", async () => {
		const res = await get("/embeddings/1:0.1?model=small");
		expect(res.status).toBe(200);
		expect(res.headers.get("x-embedding-model")).toBe("text-embedding-3-small");
		const { data } = await res.json();
		expect(data.model).toBe("text-embedding-3-small");
		expect(data.dimensions).toBe(1536);
		expect(data.embedding.length).toBe(1536);
	});

	it("returns 400 for an unknown model option", async () => {
		const res = await get("/embeddings/1:0.1?model=enormous");
		expect(res.status).toBe(400);
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
		expect(first.standardReferenceId).toBeString();
		expect(first.embedding).toBeArray();
	});

	it("returns JSON when format=json", async () => {
		const res = await get("/embeddings/export?paperId=1&format=json");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.data).toBeArray();
		expect(body.data.length).toBeGreaterThan(0);
		expect(body.data[0].standardReferenceId).toBeString();
		expect(body.data[0].embedding).toBeArray();
		expect(body.model).toBe("text-embedding-3-large");
		expect(body.dimensions).toBe(3072);
	});

	it("respects ?model=small in export", async () => {
		const res = await get("/embeddings/export?paperId=1&format=json&model=small");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.model).toBe("text-embedding-3-small");
		expect(body.dimensions).toBe(1536);
		expect(body.data[0].embedding.length).toBe(1536);
	});

	it("sets X-Embedding-Model header on JSONL export", async () => {
		const res = await get("/embeddings/export?paperId=1");
		expect(res.headers.get("x-embedding-model")).toBe("text-embedding-3-large");
		expect(res.headers.get("x-embedding-dimensions")).toBe("3072");
	});

	it("returns 400 when paperId is missing", async () => {
		const res = await get("/embeddings/export");
		expect(res.status).toBe(400);
	});
});
