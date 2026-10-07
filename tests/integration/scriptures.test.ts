import { describe, expect, it } from "bun:test";
import { get, post } from "../helpers/app.ts";

// Own rate-limit bucket: the suite shares one limiter (see CLAUDE.md).
const IP = { "cf-connecting-ip": "scriptures-test" };

describe("GET /scriptures", () => {
	it("lists the texts in Paper 131 order, then the texts with no Paper 131 heading", async () => {
		const res = await get("/scriptures", IP);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.map((c: { slug: string }) => c.slug)).toEqual([
			"diogenes-laertius-6",
			"epictetus-cynic",
			"dhammapada",
			"bhagavad-gita",
			"shinto-oracles",
			"tao-te-ching",
			"analects",
			"quran",
			"japji",
		]);
		expect(data.map((c: { urantiaSection: string | null }) => c.urantiaSection)).toEqual([
			"131:1",
			"131:1",
			"131:3",
			"131:4",
			"131:7",
			"131:8",
			"131:9",
			null,
			null,
		]);
		for (const c of data) {
			expect(c.license).toContain("Public domain");
			expect([1, 2, 3]).toContain(c.refLevels);
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
		expect((await get("/scriptures/avesta", IP)).status).toBe(404);
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

describe("GET /scriptures/{corpus}/{ref}, phase 2 ref shapes", () => {
	it("finds a three-level ref inside its five-section block, and a whole chapter", async () => {
		const one = await (await get("/scriptures/epictetus-cynic/3.22.47", IP)).json();
		expect(one.data.passages.map((p: { ref: string }) => p.ref)).toEqual(["Epictetus 3.22.45-49"]);
		expect(one.data.passages[0].subdivision).toBe(22);
		const chapter = await (await get("/scriptures/epictetus/3.22", IP)).json();
		expect(chapter.data.passages).toHaveLength(22);
	});

	it("serves the Koran by sura and verse, and Japji 0", async () => {
		const verse = await (await get("/scriptures/quran/2.255", IP)).json();
		expect(verse.data.passages[0].text).toStartWith("Allah! There is no deity save Him");
		const opening = await (await get("/scriptures/japji/0", IP)).json();
		expect(opening.data.passages[0].text).toStartWith("There is but one God whose name is true");
	});

	it("keeps the life a Diogenes Laertius section belongs to, and the oracle titles", async () => {
		const dl = await (await get("/scriptures/dl/6.20", IP)).json();
		expect(dl.data.passages[0].divisionTitle).toBe("Diogenes");
		const oracle = await (await get("/scriptures/shinto-oracles/15", IP)).json();
		expect(oracle.data.passages[0].divisionTitle).toBe("Oracle of Itsukushima in Aki");
		expect(oracle.data.passages[0].text).toContain("knew not my name");
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
	it("adds the top 3 passages of each text", async () => {
		const res = await get("/paragraphs/131:3.1?include=scriptureParallels", IP);
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.scriptureParallels).toHaveLength(27);
		const corpora = new Set(
			data.scriptureParallels.map((p: { corpus: { id: string } }) => p.corpus.id),
		);
		expect(corpora.size).toBe(9);
		expect(data.scriptureParallels[0].corpus.slug).toBe("diogenes-laertius-6");
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
