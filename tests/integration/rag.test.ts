import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

describe("GET /paragraphs/:ref?format=rag", () => {
	it("returns RAG format with correct shape", async () => {
		const res = await get("/paragraphs/2:0.1?format=rag");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.ref).toBeString();
		expect(data.text).toBeString();
		expect(data.citation).toContain("The Urantia Book");
		expect(data.citation).toContain("Paper 2");
		expect(data.tokenCount).toBeGreaterThan(0);
		expect(data.entities).toBeArray();

		// Metadata
		expect(data.metadata.paperId).toBe("2");
		expect(data.metadata.paperTitle).toBeString();
		expect(data.metadata.partId).toBeString();
		expect(data.metadata.paragraphId).toBeString();

		// Navigation
		expect(data.navigation).toBeDefined();
		expect(typeof data.navigation.prev === "string" || data.navigation.prev === null).toBe(true);
		expect(typeof data.navigation.next === "string" || data.navigation.next === null).toBe(true);
	});

	it("token count approximates word count", async () => {
		const res = await get("/paragraphs/2:0.1?format=rag");
		const { data } = await res.json();
		const manualCount = data.text.split(/\s+/).filter(Boolean).length;
		expect(data.tokenCount).toBe(manualCount);
	});

	it("prev/next are valid refs", async () => {
		// Use a paragraph in the middle of a paper
		const res = await get("/paragraphs/2:1.1?format=rag");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		// Should have both prev and next
		expect(data.navigation.prev).toBeString();
		expect(data.navigation.next).toBeString();
	});

	it("without format param returns standard shape", async () => {
		const res = await get("/paragraphs/2:0.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		// Standard shape has htmlText, audio, etc.
		expect(data.htmlText).toBeDefined();
		expect(data.audio).toBeDefined();
	});

	it("format=rag works on random endpoint", async () => {
		const res = await get("/paragraphs/random?format=rag");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.ref).toBeString();
		expect(data.citation).toContain("The Urantia Book");
		expect(data.tokenCount).toBeGreaterThan(0);
	});
});
