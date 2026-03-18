import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import { assertProblemShape } from "../helpers/shapes.ts";

describe("GET /cite", () => {
	it("returns APA citation by default", async () => {
		const res = await get("/cite?ref=196:2.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.ref).toBe("196:2.1");
		expect(data.style).toBe("apa");
		expect(data.citation).toContain("(1955)");
		expect(data.citation).toContain("Urantia Foundation");
		expect(data.citation).toContain("Paper 196, Section 2, Paragraph 1");
	});

	it("returns MLA citation", async () => {
		const res = await get("/cite?ref=1:0.1&style=mla");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.style).toBe("mla");
		expect(data.citation).toContain("Urantia Foundation, 1955");
	});

	it("returns Chicago citation", async () => {
		const res = await get("/cite?ref=1:0.1&style=chicago");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.style).toBe("chicago");
		expect(data.citation).toContain("Chicago: Urantia Foundation");
	});

	it("returns BibTeX citation", async () => {
		const res = await get("/cite?ref=1:0.1&style=bibtex");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.style).toBe("bibtex");
		expect(data.citation).toContain("@book{urantiabook");
		expect(data.citation).toContain("publisher={Urantia Foundation}");
	});

	it("accepts globalId format", async () => {
		const res = await get("/cite?ref=1:2.0.1&style=apa");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.citation).toContain("Paper 2");
	});

	it("accepts paperSectionParagraphId format", async () => {
		const res = await get("/cite?ref=2.0.1&style=apa");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.citation).toContain("Paper 2");
	});

	it("returns 400 for invalid ref", async () => {
		const res = await get("/cite?ref=invalid");
		expect(res.status).toBe(400);
		const json = await res.json();
		assertProblemShape(json);
		expect(json.detail).toContain("Invalid reference format");
	});

	it("returns 400 for missing ref", async () => {
		const res = await get("/cite");
		expect(res.status).toBe(400);
	});
});
