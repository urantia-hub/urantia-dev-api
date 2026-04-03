import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import {
	assertPaperShape,
	assertParagraphShape,
	assertSectionShape,
} from "../helpers/shapes.ts";

describe("GET /papers", () => {
	it("returns 200", async () => {
		const res = await get("/papers");
		expect(res.status).toBe(200);
	});

	it("returns a non-empty array", async () => {
		const res = await get("/papers");
		const { data } = await res.json();
		expect(data).toBeArray();
		expect(data.length).toBeGreaterThan(0);
	});

	it("each paper has exact 6-key shape", async () => {
		const res = await get("/papers");
		const { data } = await res.json();
		for (const paper of data) {
			assertPaperShape(paper);
		}
	});

	it("papers are ordered by sortId ascending", async () => {
		const res = await get("/papers");
		const { data } = await res.json();
		for (let i = 1; i < data.length; i++) {
			expect(data[i].sortId >= data[i - 1].sortId).toBe(true);
		}
	});

	it("papers include video field with nova voice", async () => {
		const res = await get("/papers");
		const { data } = await res.json();
		const paper = data.find((p: any) => p.id === "1");
		expect(paper.video).toBeDefined();
		expect(paper.video.nova).toBeDefined();
		expect(paper.video.nova.mp4).toContain("video.urantiahub.com");
		expect(paper.video.nova.thumbnail).toContain("thumbnail-1.png");
		expect(paper.video.nova.duration).toBeGreaterThan(0);
	});
});

describe("GET /papers/:id (valid)", () => {
	it("returns 200 for paper 2", async () => {
		const res = await get("/papers/2");
		expect(res.status).toBe(200);
	});

	it("response has { paper, paragraphs }", async () => {
		const res = await get("/papers/2");
		const { data } = await res.json();
		expect(data.paper).toBeDefined();
		expect(data.paragraphs).toBeArray();
		expect(data.paragraphs.length).toBeGreaterThan(0);
	});

	it("paper has exact 6-key shape", async () => {
		const res = await get("/papers/2");
		const { data } = await res.json();
		assertPaperShape(data.paper);
	});

	it("each paragraph has exact 13-key shape", async () => {
		const res = await get("/papers/2");
		const { data } = await res.json();
		for (const p of data.paragraphs) {
			assertParagraphShape(p);
		}
	});

	it("sectionId is just the section number, not composite", async () => {
		const res = await get("/papers/2");
		const { data } = await res.json();
		for (const p of data.paragraphs) {
			if (p.sectionId !== null) {
				expect(p.sectionId).not.toContain(".");
			}
		}
	});

	it("paragraphs are ordered by sortId ascending", async () => {
		const res = await get("/papers/2");
		const { data } = await res.json();
		for (let i = 1; i < data.paragraphs.length; i++) {
			expect(
				data.paragraphs[i].sortId >= data.paragraphs[i - 1].sortId,
			).toBe(true);
		}
	});
});

describe("GET /papers/:id (invalid)", () => {
	it("returns 404 for paper 999", async () => {
		const res = await get("/papers/999");
		expect(res.status).toBe(404);
		const json = await res.json();
		expect(json.detail).toBeString();
		expect(json.status).toBe(404);
	});
});

describe("GET /papers/:id/sections", () => {
	it("returns 200 for paper 1", async () => {
		const res = await get("/papers/1/sections");
		expect(res.status).toBe(200);
	});

	it("each section has exact 6-key shape", async () => {
		const res = await get("/papers/1/sections");
		const { data } = await res.json();
		expect(data).toBeArray();
		for (const s of data) {
			assertSectionShape(s);
		}
	});

	it("sections are ordered by sortId ascending", async () => {
		const res = await get("/papers/1/sections");
		const { data } = await res.json();
		for (let i = 1; i < data.length; i++) {
			expect(data[i].sortId >= data[i - 1].sortId).toBe(true);
		}
	});

	it("returns 404 for paper 999", async () => {
		const res = await get("/papers/999/sections");
		expect(res.status).toBe(404);
	});
});
