import { describe, expect, it } from "bun:test";
import { get, post } from "../helpers/app.ts";
import {
	assertMetaShape,
	assertSearchResultShape,
	assertSemanticResultShape,
} from "../helpers/shapes.ts";

describe("POST /search (full-text)", () => {
	it("returns 200 for valid query", async () => {
		const res = await post("/search", { q: "God" });
		expect(res.status).toBe(200);
	});

	it("each result has paragraph shape + rank", async () => {
		const res = await post("/search", { q: "God", limit: 3 });
		const { data } = await res.json();
		expect(data.length).toBeGreaterThan(0);
		for (const r of data) {
			assertSearchResultShape(r);
		}
	});

	it("meta has correct shape", async () => {
		const res = await post("/search", { q: "God" });
		const { meta } = await res.json();
		assertMetaShape(meta);
	});

	it("respects limit parameter", async () => {
		const res = await post("/search", { q: "God", limit: 5 });
		const { data } = await res.json();
		expect(data.length).toBeLessThanOrEqual(5);
	});

	it("respects page parameter", async () => {
		const res = await post("/search", { q: "God", limit: 5, page: 1 });
		expect(res.status).toBe(200);
		const { meta } = await res.json();
		expect(meta.page).toBe(1);
	});

	it("type='phrase' works", async () => {
		const res = await post("/search", {
			q: "nature of God",
			type: "phrase",
			limit: 5,
		});
		expect(res.status).toBe(200);
	});

	it("type='or' returns results", async () => {
		const res = await post("/search", {
			q: "love truth",
			type: "or",
			limit: 5,
		});
		expect(res.status).toBe(200);
		const { data } = await res.json();
		expect(data.length).toBeGreaterThan(0);
	});

	it("paperId filter narrows results", async () => {
		const res = await post("/search", { q: "God", paperId: "2", limit: 5 });
		expect(res.status).toBe(200);
		const { data } = await res.json();
		for (const r of data) {
			expect(r.paperId).toBe("2");
		}
	});

	it("partId filter narrows results", async () => {
		const res = await post("/search", { q: "God", partId: "1", limit: 5 });
		expect(res.status).toBe(200);
		const { data } = await res.json();
		for (const r of data) {
			expect(r.partId).toBe("1");
		}
	});

	it("returns 400 for empty query", async () => {
		const res = await post("/search", { q: "" });
		expect(res.status).toBe(400);
	});
});

const hasOpenAI = !!process.env.OPENAI_API_KEY;

describe.skipIf(!hasOpenAI)("POST /search/semantic", () => {
	it("returns 200 for valid query", async () => {
		const res = await post("/search/semantic", {
			q: "meaning of life",
			limit: 3,
		});
		expect(res.status).toBe(200);
	}, 15_000);

	it("each result has paragraph shape + similarity", async () => {
		const res = await post("/search/semantic", {
			q: "meaning of life",
			limit: 3,
		});
		const { data } = await res.json();
		expect(data.length).toBeGreaterThan(0);
		for (const r of data) {
			assertSemanticResultShape(r);
		}
	});

	it("meta has correct shape", async () => {
		const res = await post("/search/semantic", {
			q: "meaning of life",
			limit: 3,
		});
		const { meta } = await res.json();
		assertMetaShape(meta);
	});

	it("puts a pasted paragraph first, and counts at most 100", async () => {
		const ip = { "cf-connecting-ip": "203.0.113.43" };
		const ref = await (await post("/search", { q: "111:7.5" }, ip)).json();
		const res = await post("/search/semantic", { q: ref.data[0].text, limit: 5 }, ip);
		const { data, meta } = await res.json();
		expect(data[0].standardReferenceId).toBe("111:7.5");
		expect(data[0].match).toBe("exact");
		expect(meta.total).toBeLessThanOrEqual(100);
	}, 30_000);

	it("respects paperId filter", async () => {
		const res = await post("/search/semantic", {
			q: "God",
			paperId: "2",
			limit: 3,
		});
		expect(res.status).toBe(200);
		const { data } = await res.json();
		for (const r of data) {
			expect(r.paperId).toBe("2");
		}
	});
});

describe("POST /search/semantic (reference)", () => {
	it("gives the paragraph of a reference with no vector", async () => {
		const res = await post(
			"/search/semantic",
			{ q: "99:1.1" },
			{ "cf-connecting-ip": "203.0.113.44" },
		);
		const { data, meta } = await res.json();
		expect(data.map((r: { standardReferenceId: string }) => r.standardReferenceId)).toEqual([
			"99:1.1",
		]);
		expect(data[0].match).toBe("reference");
		expect(meta.total).toBe(1);
		expect(meta.related).toBe(1);
	});
});

describe("POST /search (auto)", () => {
	// Its own caller address, so these requests do not count against the shared limit.
	const ip = { "cf-connecting-ip": "203.0.113.42" };
	it("gives the paragraph of a reference first", async () => {
		const { data } = await (await post("/search", { q: "68:6.3" }, ip)).json();
		expect(data[0].standardReferenceId).toBe("68:6.3");
		expect(data[0].match).toBe("reference");
	});

	it("puts the exact phrase first", async () => {
		const { data } = await (
			await post("/search", { q: "such a life on such a planet" }, ip)
		).json();
		expect(data[0].standardReferenceId).toBe("111:7.5");
		expect(data[0].match).toBe("exact");
	});

	it("fixes a typo and says so", async () => {
		const { data, meta } = await (await post("/search", { q: "universal fahter" }, ip)).json();
		expect(meta.didYouMean).toBe("universal father");
		expect(data[0].match).toBe("near");
	});

	it("answers 200 for common words, syntax, and a paper that does not exist", async () => {
		for (const q of ["the of and", "a & b | !c:* 'd' \\e (f)", "197:1.1", "68:99.1"]) {
			expect((await post("/search", { q }, ip)).status).toBe(200);
		}
	});
});

describe("GET /search lang=es", () => {
	const ip = { "cf-connecting-ip": "10.0.8.1" };
	// biome-ignore lint: test body
	const search = async (q: string, extra = "") =>
		(await (await get(`/search?q=${encodeURIComponent(q)}&lang=es${extra}`, ip)).json()) as any;
	it("finds Spanish rows, exact first, with marks", async () => {
		const body = await search("Ajustador del Pensamiento");
		expect(body.meta.total).toBeGreaterThan(0);
		expect(body.data.every((r: { language: string }) => r.language === "es")).toBe(true);
		expect(body.data[0].match).toBe("exact");
		expect(body.data[0].htmlText).toContain("urantia-dev-highlighted");
		expect(body.data[0].paperTitle).not.toMatch(/^The /);
	});
	it("gives the same rows with or without capitals and accents", async () => {
		const ids = (b: { data: { id: string }[] }) => b.data.slice(0, 10).map((r) => r.id);
		expect(ids(await search("ajustador del pensamiento"))).toEqual(
			ids(await search("Ajustador del Pensamiento")),
		);
		expect(ids(await search("religion"))).toEqual(ids(await search("religión")));
	}, 30_000);
	it("reads documento 1 as a reference", async () => {
		const body = await search("documento 1");
		expect(body.data[0].match).toBe("reference");
		expect(body.data[0].paperId).toBe("1");
		expect(body.data[0].language).toBe("es");
	});
	it("answers 200 with no rows for a word that is in no paragraph", async () => {
		const body = await search("zzzqqq");
		expect(body.meta.total).toBe(0);
		expect(body.data).toEqual([]);
	});
	it("leaves English search as it is", async () => {
		const a = await (await get("/search?q=thought%20adjuster", ip)).json();
		const b = await (await get("/search?q=thought%20adjuster&lang=eng", ip)).json();
		expect(b).toEqual(a);
	}, 30_000);
});
