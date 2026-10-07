import { describe, expect, it } from "bun:test";
import { get } from "../helpers/app.ts";

// Own rate-limit bucket: the suite shares one limiter (see CLAUDE.md).
const IP = { "cf-connecting-ip": "scripture-insights-test" };

describe("GET /scriptures/insights/shared-currents", () => {
	it("ranks by consensus, leaves out Paper 131, and names the closest texts", async () => {
		const res = await get("/scriptures/insights/shared-currents?limit=10", IP);
		expect(res.status).toBe(200);
		const { data, meta } = await res.json();
		expect(data).toHaveLength(10);
		expect(meta.total).toBeGreaterThan(11000);
		expect(
			data.every((d: { paragraph: { paperId: string } }) => d.paragraph.paperId !== "131"),
		).toBe(true);
		const scores = data.map((d: { consensus: number }) => d.consensus);
		expect(scores).toEqual([...scores].sort((a, b) => b - a));
		expect(data[0].closest).toHaveLength(3);
		expect(data[0].closest[0].percentile).toBeGreaterThan(0.9);
	});

	it("leaves out short paragraphs by default, and on request", async () => {
		const { data } = await (await get("/scriptures/insights/shared-currents?limit=20", IP)).json();
		expect(data.every((d: { paragraph: { text: string } }) => d.paragraph.text.length >= 200)).toBe(
			true,
		);
		const all = await (
			await get("/scriptures/insights/shared-currents?limit=1&minLength=0", IP)
		).json();
		const some = await (await get("/scriptures/insights/shared-currents?limit=1", IP)).json();
		expect(all.meta.total).toBeGreaterThan(some.meta.total);
	});

	it("filters by paper", async () => {
		const { data } = await (
			await get("/scriptures/insights/shared-currents?paperId=140&limit=5", IP)
		).json();
		expect(
			data.every((d: { paragraph: { paperId: string } }) => d.paragraph.paperId === "140"),
		).toBe(true);
	});
});

describe("GET /scriptures/insights/far", () => {
	it("ranks by distance within a paper", async () => {
		const { data } = await (await get("/scriptures/insights/far?paperId=108&limit=5", IP)).json();
		expect(data.length).toBeGreaterThan(0);
		const d = data.map((x: { distance: number }) => x.distance);
		expect(d).toEqual([...d].sort((a, b) => b - a));
		expect(
			data.every((x: { paragraph: { paperId: string } }) => x.paragraph.paperId === "108"),
		).toBe(true);
	});

	it("rejects a paper that does not exist", async () => {
		expect((await get("/scriptures/insights/far?paperId=300", IP)).status).toBe(400);
	});
});

describe("GET /scriptures/insights/pairs", () => {
	it("returns pairs with both models' similarity, for one text", async () => {
		const { data } = await (await get("/scriptures/insights/pairs?corpus=dl&limit=5", IP)).json();
		expect(data.length).toBeGreaterThan(0);
		for (const p of data) {
			expect(p.corpus.slug).toBe("diogenes-laertius-6");
			expect(p.passage.reference).toStartWith("DL 6.");
			expect(p.similaritySmall).toBeGreaterThan(0);
		}
	});

	it("can leave out the Bible", async () => {
		const { data } = await (
			await get("/scriptures/insights/pairs?excludeBible=true&limit=20", IP)
		).json();
		expect(data.length).toBeGreaterThan(0);
		expect(data.every((p: { corpus: { id: string } }) => p.corpus.id !== "bible")).toBe(true);
	});

	it("covers the Bible and rejects an unknown text", async () => {
		const { data } = await (
			await get("/scriptures/insights/pairs?corpus=bible&limit=2", IP)
		).json();
		expect(data[0].corpus.id).toBe("bible");
		expect(data[0].passage.reference).toMatch(/\d+:\d+/);
		expect((await get("/scriptures/insights/pairs?corpus=avesta", IP)).status).toBe(400);
	});
});

describe("GET /scriptures/insights/leans", () => {
	it("returns leans for one text, largest gap first", async () => {
		const { data } = await (
			await get("/scriptures/insights/leans?corpus=quran&limit=5", IP)
		).json();
		expect(data.length).toBeGreaterThan(0);
		const gaps = data.map((d: { gap: number }) => d.gap);
		expect(gaps).toEqual([...gaps].sort((a, b) => b - a));
		expect(data.every((d: { percentile: number }) => d.percentile >= 0.9)).toBe(true);
	});
});

describe("GET /paragraphs/{ref}?include=scriptureScores", () => {
	it("adds the scores, the profile, and any mutual pairs", async () => {
		const { data } = await (await get("/paragraphs/131:7.2?include=scriptureScores", IP)).json();
		const s = data.scriptureScores;
		expect(s.profile).toHaveLength(10);
		expect(s.textsClose).toBeGreaterThanOrEqual(0);
		expect(
			s.mutualPairs.map((p: { passage: { reference: string } }) => p.passage.reference),
		).toContain("Oracle 15");
	});
});
