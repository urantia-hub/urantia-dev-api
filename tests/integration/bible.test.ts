import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import {
	assertBibleBookShape,
	assertBibleChapterShape,
	assertBibleVerseShape,
} from "../helpers/shapes.ts";

describe("GET /bible/books", () => {
	it("returns 200", async () => {
		const res = await get("/bible/books");
		expect(res.status).toBe(200);
	});

	it("returns all 81 books", async () => {
		const res = await get("/bible/books");
		const { data } = await res.json();
		expect(data).toBeArray();
		expect(data).toHaveLength(81);
	});

	it("each book has the canonical 8-key shape", async () => {
		const res = await get("/bible/books");
		const { data } = await res.json();
		for (const book of data) assertBibleBookShape(book);
	});

	it("returns books in canonical order (Genesis first, Revelation last)", async () => {
		const res = await get("/bible/books");
		const { data } = await res.json();
		expect(data[0].bookCode).toBe("Gen");
		expect(data[80].bookCode).toBe("Rev");
		expect(data[0].bookOrder).toBe(1);
		expect(data[80].bookOrder).toBe(81);
	});

	it("classifies books into ot, deuterocanon, nt", async () => {
		const res = await get("/bible/books");
		const { data } = await res.json();
		const counts = data.reduce(
			(acc: Record<string, number>, b: { canon: string }) => {
				acc[b.canon] = (acc[b.canon] ?? 0) + 1;
				return acc;
			},
			{},
		);
		expect(counts).toEqual({ ot: 39, deuterocanon: 15, nt: 27 });
	});

	it("Genesis has 50 chapters and 1533 verses", async () => {
		const res = await get("/bible/books");
		const { data } = await res.json();
		const gen = data.find((b: { bookCode: string }) => b.bookCode === "Gen");
		expect(gen.chapterCount).toBe(50);
		expect(gen.verseCount).toBe(1533);
	});
});

describe("GET /bible/{bookCode}", () => {
	it("returns 200 for OSIS code", async () => {
		const res = await get("/bible/Gen");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertBibleBookShape(data);
		expect(data.bookCode).toBe("Gen");
	});

	it("accepts USFM codes", async () => {
		const res = await get("/bible/MAT");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.bookCode).toBe("Matt");
	});

	it("accepts full names case-insensitively", async () => {
		const res = await get("/bible/genesis");
		const { data } = await res.json();
		expect(data.bookCode).toBe("Gen");
	});

	it("accepts hyphenated aliases", async () => {
		const res = await get("/bible/1-maccabees");
		const { data } = await res.json();
		expect(data.bookCode).toBe("1Macc");
		expect(data.canon).toBe("deuterocanon");
	});

	it("resolves embedded books to their containing book", async () => {
		const res = await get("/bible/letterofjeremiah");
		const { data } = await res.json();
		expect(data.bookCode).toBe("Bar");
	});

	it("returns 404 RFC 9457 problem+json for unknown book", async () => {
		const res = await get("/bible/NotABook");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body).toEqual({
			type: expect.any(String),
			title: expect.any(String),
			status: 404,
			detail: expect.stringContaining("NotABook"),
		});
	});
});

describe("GET /bible/{bookCode}/{chapter}", () => {
	it("returns Genesis 1 with all 31 verses", async () => {
		const res = await get("/bible/Gen/1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertBibleChapterShape(data);
		expect(data.chapter).toBe(1);
		expect(data.verses).toBeArray();
		expect(data.verses).toHaveLength(31);
	});

	it("each verse has the canonical 10-key shape", async () => {
		const res = await get("/bible/Gen/1");
		const { data } = await res.json();
		for (const v of data.verses) assertBibleVerseShape(v);
	});

	it("verses are ordered by verse number", async () => {
		const res = await get("/bible/Gen/1");
		const { data } = await res.json();
		for (let i = 1; i < data.verses.length; i++) {
			expect(data.verses[i].verse).toBeGreaterThan(data.verses[i - 1].verse);
		}
	});

	it("returns 404 for unknown book", async () => {
		const res = await get("/bible/NotABook/1");
		expect(res.status).toBe(404);
	});

	it("returns 404 for missing chapter", async () => {
		const res = await get("/bible/Gen/999");
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.detail).toContain("Genesis");
		expect(body.detail).toContain("999");
	});
});

describe("GET /bible/{bookCode}/{chapter}/{verse}/paragraphs", () => {
	it("returns the verse, its chunk, and top UB paragraphs", async () => {
		const res = await get("/bible/Gen/1/1/paragraphs");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toHaveProperty("verse");
		expect(data).toHaveProperty("chunk");
		expect(data).toHaveProperty("paragraphs");
		expect(data.verse.reference).toBe("Genesis 1:1");
		expect(data.chunk.id).toMatch(/^Gen\.1\./);
		expect(data.paragraphs).toBeArray();
		// Up to 10 paragraphs (less if seed hasn't fully populated)
		if (data.paragraphs.length > 0) {
			const p = data.paragraphs[0];
			expect(p).toHaveProperty("standardReferenceId");
			expect(p).toHaveProperty("similarity");
			expect(p).toHaveProperty("rank");
			expect(p.source).toBe("semantic");
			expect(p.embeddingModel).toBe("text-embedding-3-large");
		}
	});

	it("returns 404 for unknown book", async () => {
		const res = await get("/bible/NotABook/1/1/paragraphs");
		expect(res.status).toBe(404);
	});
});

describe("GET /bible/{bookCode}/{chapter}/{verse}", () => {
	it("returns Gen 1:1 with the canonical text", async () => {
		const res = await get("/bible/Gen/1/1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertBibleVerseShape(data);
		expect(data.id).toBe("Gen.1.1");
		expect(data.reference).toBe("Genesis 1:1");
		expect(data.text).toBe("In the beginning, God created the heavens and the earth.");
		expect(data.canon).toBe("ot");
	});

	it("WEB Classic preserves Yahweh in Gen 2:4", async () => {
		const res = await get("/bible/Gen/2/4");
		const { data } = await res.json();
		expect(data.text).toContain("Yahweh");
	});

	it("returns John 11:35 short verse", async () => {
		const res = await get("/bible/John/11/35");
		const { data } = await res.json();
		expect(data.text).toBe("Jesus wept.");
	});

	it("returns deuterocanonical Daniel (Greek) 3:24", async () => {
		const res = await get("/bible/DanGr/3/24");
		const { data } = await res.json();
		expect(data.canon).toBe("deuterocanon");
		expect(data.bookName).toBe("Daniel (Greek)");
		expect(data.text.length).toBeGreaterThan(0);
	});

	it("returns 404 for unknown book", async () => {
		const res = await get("/bible/NotABook/1/1");
		expect(res.status).toBe(404);
	});

	it("returns 404 for missing verse", async () => {
		const res = await get("/bible/Gen/1/9999");
		expect(res.status).toBe(404);
	});
});
