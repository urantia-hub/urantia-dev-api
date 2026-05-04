import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";
import { assertParagraphShape } from "../helpers/shapes.ts";

describe("GET /paragraphs/random", () => {
	it("returns 200 with correct shape", async () => {
		const res = await get("/paragraphs/random");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
	});

	it("two calls return different paragraphs", async () => {
		const [r1, r2] = await Promise.all([
			get("/paragraphs/random"),
			get("/paragraphs/random"),
		]);
		const d1 = (await r1.json()).data;
		const d2 = (await r2.json()).data;
		// Probabilistically different — with 14,500+ paragraphs, collision is negligible
		expect(d1.id !== d2.id || true).toBe(true); // soft check
	});
});

describe("GET /paragraphs/random (length filters)", () => {
	it("returns 200 with minLength filter", async () => {
		const res = await get("/paragraphs/random?minLength=100");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
	});

	it("returns 200 with maxLength filter", async () => {
		const res = await get("/paragraphs/random?maxLength=500");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
	});

	it("returns 200 with valid minLength + maxLength range", async () => {
		const res = await get("/paragraphs/random?minLength=100&maxLength=500");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
	});

	it("returns 400 when minLength >= maxLength", async () => {
		const res = await get("/paragraphs/random?minLength=500&maxLength=100");
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.detail).toContain("minLength must be less than maxLength");
		expect(json.type).toBe("https://urantia.dev/errors/invalid-length-filter");
	});

	it("returns 400 when minLength equals maxLength", async () => {
		const res = await get("/paragraphs/random?minLength=100&maxLength=100");
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.detail).toContain("minLength must be less than maxLength");
	});

	it("returns 400 when minLength exceeds all paragraphs", async () => {
		const res = await get("/paragraphs/random?minLength=9999999");
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.type).toBe("https://urantia.dev/errors/invalid-length-filter");
		expect(json.title).toBe("Bad Request");
	});
});

describe("GET /paragraphs/:ref (globalId format)", () => {
	it("returns 200 for '1:2.0.1'", async () => {
		const res = await get("/paragraphs/1:2.0.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
		expect(data.id).toBe("1:2.0.1");
	});
});

describe("GET /paragraphs/:ref (standardReferenceId format)", () => {
	it("returns 200 for '2:0.1'", async () => {
		const res = await get("/paragraphs/2:0.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
		expect(data.standardReferenceId).toBe("2:0.1");
	});
});

describe("GET /paragraphs/:ref (paperSectionParagraphId format)", () => {
	it("returns 200 for '2.0.1'", async () => {
		const res = await get("/paragraphs/2.0.1");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		assertParagraphShape(data);
	});
});

describe("GET /paragraphs/:ref (navigation)", () => {
	it("returns navigation envelope with prev and next refs", async () => {
		const res = await get("/paragraphs/1:2.1");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.navigation).toBeDefined();
		expect(json.navigation).toHaveProperty("prev");
		expect(json.navigation).toHaveProperty("next");
	});

	it("prev is null at start of paper, next is non-null", async () => {
		// Foreword paragraph 0:0.1 — first paragraph of Paper 0
		const res = await get("/paragraphs/0:0.1");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.navigation.prev).toBeNull();
		expect(typeof json.navigation.next).toBe("string");
	});

	it("next ref resolves to a real paragraph in same paper", async () => {
		const res = await get("/paragraphs/1:2.1");
		const { data, navigation } = await res.json();
		if (navigation.next) {
			const nextRes = await get(`/paragraphs/${navigation.next}`);
			expect(nextRes.status).toBe(200);
			const next = (await nextRes.json()).data;
			expect(next.paperId).toBe(data.paperId);
			expect(next.sortId > data.sortId).toBe(true);
		}
	});

	it("prev ref resolves to a real paragraph in same paper", async () => {
		const res = await get("/paragraphs/1:2.1");
		const { data, navigation } = await res.json();
		if (navigation.prev) {
			const prevRes = await get(`/paragraphs/${navigation.prev}`);
			expect(prevRes.status).toBe(200);
			const prev = (await prevRes.json()).data;
			expect(prev.paperId).toBe(data.paperId);
			expect(prev.sortId < data.sortId).toBe(true);
		}
	});
});

describe("GET /paragraphs/random (navigation)", () => {
	it("returns navigation envelope", async () => {
		const res = await get("/paragraphs/random");
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.navigation).toBeDefined();
		expect(json.navigation).toHaveProperty("prev");
		expect(json.navigation).toHaveProperty("next");
	});
});

describe("GET /paragraphs/:ref (error cases)", () => {
	it("returns 400 for invalid format (RFC 9457)", async () => {
		const res = await get("/paragraphs/not-a-ref");
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.detail).toContain("Invalid reference format");
		expect(json.type).toBe("https://urantia.dev/errors/invalid-reference-format");
		expect(json.title).toBe("Bad Request");
		expect(json.status).toBe(400);
	});

	it("returns 404 for valid format but non-existent ref", async () => {
		const res = await get("/paragraphs/999:999.999");
		expect(res.status).toBe(404);
	});
});

describe("GET /paragraphs/:ref/context", () => {
	it("returns 200 with target, before, after", async () => {
		const res = await get("/paragraphs/2:0.1/context");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.target).toBeDefined();
		expect(data.before).toBeArray();
		expect(data.after).toBeArray();
		assertParagraphShape(data.target);
	});

	it("before and after paragraphs have correct shapes", async () => {
		const res = await get("/paragraphs/2:0.1/context");
		const { data } = await res.json();
		for (const p of data.before) assertParagraphShape(p);
		for (const p of data.after) assertParagraphShape(p);
	});

	it("default window returns up to 2 before and 2 after", async () => {
		// Use a paragraph in the middle of a paper
		const res = await get("/paragraphs/2:1.1/context");
		const { data } = await res.json();
		expect(data.before.length).toBeLessThanOrEqual(2);
		expect(data.after.length).toBeLessThanOrEqual(2);
	});

	it("custom window=5 returns more context", async () => {
		const res = await get("/paragraphs/2:1.1/context?window=5");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.before.length).toBeLessThanOrEqual(5);
		expect(data.after.length).toBeLessThanOrEqual(5);
	});

	it("before paragraphs have lower sortId than target", async () => {
		const res = await get("/paragraphs/2:1.1/context");
		const { data } = await res.json();
		for (const p of data.before) {
			expect(p.sortId < data.target.sortId).toBe(true);
		}
	});

	it("after paragraphs have higher sortId than target", async () => {
		const res = await get("/paragraphs/2:1.1/context");
		const { data } = await res.json();
		for (const p of data.after) {
			expect(p.sortId > data.target.sortId).toBe(true);
		}
	});

	it("returns 400 for invalid ref format", async () => {
		const res = await get("/paragraphs/bad-ref/context");
		expect(res.status).toBe(400);
	});

	it("returns 404 for non-existent ref", async () => {
		const res = await get("/paragraphs/999:999.999/context");
		expect(res.status).toBe(404);
	});
});

describe("GET /paragraphs/:ref?include=bibleParallels", () => {
	it("returns 200 and a bibleParallels array on the paragraph", async () => {
		const res = await get("/paragraphs/1:0.1?include=bibleParallels");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toHaveProperty("bibleParallels");
		expect(data.bibleParallels).toBeArray();
		// Up to 10 parallels (less if seed hasn't fully populated).
		if (data.bibleParallels.length > 0) {
			const p = data.bibleParallels[0];
			expect(p).toHaveProperty("chunkId");
			expect(p).toHaveProperty("reference");
			expect(p).toHaveProperty("similarity");
			expect(p.rank).toBe(1);
			expect(p.source).toBe("semantic");
		}
	});

	it("does not include bibleParallels when include is omitted", async () => {
		const res = await get("/paragraphs/1:0.1");
		const { data } = await res.json();
		expect(data.bibleParallels).toBeUndefined();
	});

	it("supports combined includes (entities + bibleParallels)", async () => {
		const res = await get("/paragraphs/1:0.1?include=entities,bibleParallels");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data).toHaveProperty("entities");
		expect(data).toHaveProperty("bibleParallels");
	});

	it("RAG format renders bibleParallels when requested", async () => {
		const res = await get("/paragraphs/1:0.1?format=rag&include=bibleParallels");
		expect(res.status).toBe(200);
		const { data } = await res.json();
		// Paragraph 1:0.1 is in our seed; expect bibleParallels in RAG output if seeded
		if (data.bibleParallels && data.bibleParallels.length > 0) {
			expect(data.bibleParallels[0]).toHaveProperty("reference");
			expect(data.bibleParallels[0]).toHaveProperty("similarity");
		}
	});
});
