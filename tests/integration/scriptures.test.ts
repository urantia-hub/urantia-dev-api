import { describe, expect, it } from "bun:test";
import { get, post } from "../helpers/app.ts";

// Own rate-limit bucket: the suite shares one limiter (see CLAUDE.md).
const IP = { "cf-connecting-ip": "scriptures-test" };

describe("GET /scriptures", () => {
	it("lists the four phase 1 texts in order, with their Paper 131 sections", async () => {
		const res = await get("/scriptures", IP);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.map((c: { slug: string }) => c.slug)).toEqual([
			"dhammapada",
			"tao-te-ching",
			"analects",
			"bhagavad-gita",
		]);
		expect(data.map((c: { urantiaSection: string }) => c.urantiaSection)).toEqual([
			"131:3",
			"131:8",
			"131:9",
			"131:4",
		]);
		for (const c of data) {
			expect(c.license).toContain("Public domain");
			expect(c.passageCount).toBeGreaterThan(200);
		}
	});
});

describe("GET /scriptures/{corpus}", () => {
	it("accepts the slug, the id, and the ref prefix", async () => {
		for (const name of ["bhagavad-gita", "bhagavad-gita-besant-1922", "BG"]) {
			const res = await get(`/scriptures/${name}`, IP);
			expect(res.status).toBe(200);
			const { data } = await res.json();
			expect(data.id).toBe("bhagavad-gita-besant-1922");
			expect(data.divisions).toHaveLength(18);
			expect(data.divisions[1]).toMatchObject({
				division: 2,
				firstRef: "BG 2.1",
				lastRef: "BG 2.72",
			});
		}
	});

	it("returns 404 for an unknown corpus", async () => {
		expect((await get("/scriptures/quran", IP)).status).toBe(404);
	});
});

describe("GET /scriptures/{corpus}/{ref}", () => {
	it("returns one verse, with or without the prefix", async () => {
		for (const ref of ["2.47", "BG%202.47", "2:47"]) {
			const res = await get(`/scriptures/bg/${ref}`, IP);
			expect(res.status).toBe(200);
			const { data } = await res.json();
			expect(data.passages).toHaveLength(1);
			expect(data.passages[0].ref).toBe("BG 2.47");
			expect(data.passages[0].text).toContain("action");
		}
	});

	it("returns a range and a whole chapter", async () => {
		const range = await (await get("/scriptures/bg/2.47-49", IP)).json();
		expect(range.data.passages.map((p: { ref: string }) => p.ref)).toEqual([
			"BG 2.47",
			"BG 2.48",
			"BG 2.49",
		]);
		const chapter = await (await get("/scriptures/tao-te-ching/1", IP)).json();
		expect(chapter.data.passages.length).toBeGreaterThan(1);
		expect(chapter.data.passages.every((p: { division: number }) => p.division === 1)).toBe(true);
	});

	it("reads a bare Dhammapada number as a verse, inside a combined passage too", async () => {
		const one = await (await get("/scriptures/dhammapada/183", IP)).json();
		expect(one.data.passages.map((p: { ref: string }) => p.ref)).toEqual(["Dhp 183"]);
		const pair = await (await get("/scriptures/dhp/59", IP)).json();
		expect(pair.data.passages.map((p: { ref: string }) => p.ref)).toEqual(["Dhp 58-59"]);
	});

	it("returns 400 for a bad ref and 404 for a missing one", async () => {
		expect((await get("/scriptures/bg/abc", IP)).status).toBe(400);
		expect((await get("/scriptures/bg/19.1", IP)).status).toBe(404);
	});
});

describe("GET /scriptures/{corpus}/{ref}/urantia-parallels", () => {
	it("returns the chunk and 10 ranked Urantia paragraphs", async () => {
		const res = await get("/scriptures/bg/2.47/urantia-parallels", IP);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.passage.ref).toBe("BG 2.47");
		expect(data.chunk.text).toContain(data.passage.text);
		expect(data.urantiaParallels).toHaveLength(10);
		expect(data.urantiaParallels.map((p: { rank: number }) => p.rank)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		]);
	});

	it("returns 400 for a ref that names more than one passage", async () => {
		expect((await get("/scriptures/bg/2/urantia-parallels", IP)).status).toBe(400);
	});
});

describe("GET /paragraphs/{ref}?include=scriptureParallels", () => {
	it("adds the top 3 passages of each corpus", async () => {
		const res = await get("/paragraphs/131:3.1?include=scriptureParallels", IP);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.scriptureParallels).toHaveLength(12);
		const corpora = new Set(
			data.scriptureParallels.map((p: { corpus: { id: string } }) => p.corpus.id),
		);
		expect(corpora.size).toBe(4);
		expect(data.scriptureParallels[0].corpus.slug).toBe("dhammapada");
	});
});

describe("POST /scriptures/search/semantic", () => {
	it("finds passages by meaning, filtered to one corpus", async () => {
		const res = await post(
			"/scriptures/search/semantic",
			{ q: "the way that can be told is not the eternal way", corpus: "ttc", limit: 3 },
			IP,
		);
		expect(res.status).toBe(200);
		const { data, meta } = await res.json();
		expect(data).toHaveLength(3);
		expect(data[0].reference).toBe("TTC 1");
		expect(data.every((d: { corpus: { slug: string } }) => d.corpus.slug === "tao-te-ching")).toBe(
			true,
		);
		expect(data[0].urantiaParallels).toHaveLength(3);
		expect(meta.total).toBe(81);
	});
});
