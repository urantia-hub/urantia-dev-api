import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import {
	assertEntityShape,
	assertMetaShape,
	assertParagraphShape,
} from "../helpers/shapes.ts";

describe("GET /entities", () => {
	it("returns 200 with paginated results", async () => {
		const res = await get("/entities");
		expect(res.status).toBe(200);
		const { data, meta } = await res.json();
		expect(data).toBeArray();
		expect(data.length).toBeGreaterThan(0);
		assertMetaShape(meta);
	});

	it("each entity has correct shape", async () => {
		const res = await get("/entities?limit=5");
		const { data } = await res.json();
		for (const e of data) {
			assertEntityShape(e);
		}
	});

	it("respects limit parameter", async () => {
		const res = await get("/entities?limit=3");
		const { data } = await res.json();
		expect(data.length).toBeLessThanOrEqual(3);
	});

	it("type filter works", async () => {
		const res = await get("/entities?type=being&limit=5");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.length).toBeGreaterThan(0);
		for (const e of data) {
			expect(e.type).toBe("being");
		}
	});

	it("name search works", async () => {
		const res = await get("/entities?q=adam&limit=5");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.length).toBeGreaterThan(0);
	});
});

describe("GET /entities/:id", () => {
	it("returns 200 for known entity", async () => {
		// First get an entity ID from the list
		const listRes = await get("/entities?limit=1");
		const { data: listData } = await listRes.json();
		const entityId = listData[0].id;

		const res = await get(`/entities/${entityId}`);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertEntityShape(data);
		expect(data.id).toBe(entityId);
	});

	it("returns 404 for unknown entity", async () => {
		const res = await get("/entities/nonexistent-entity-xyz");
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.detail).toContain("not found");
	});
});

describe("GET /entities/:id/paragraphs", () => {
	it("returns 200 with paragraph shapes", async () => {
		// Find an entity with citations
		const listRes = await get("/entities?limit=10");
		const { data: listData } = await listRes.json();
		const entityWithCitations = listData.find(
			(e: { citationCount: number }) => e.citationCount > 0,
		);

		if (!entityWithCitations) {
			console.warn("No entities with citations found, skipping test");
			return;
		}

		const res = await get(`/entities/${entityWithCitations.id}/paragraphs?limit=3`);
		expect(res.status).toBe(200);
		const { data, meta } = await res.json();
		expect(data).toBeArray();
		assertMetaShape(meta);

		if (data.length > 0) {
			for (const p of data) {
				assertParagraphShape(p);
			}
		}
	});

	it("returns 404 for unknown entity", async () => {
		const res = await get("/entities/nonexistent-entity-xyz/paragraphs");
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.detail).toContain("not found");
	});
});
