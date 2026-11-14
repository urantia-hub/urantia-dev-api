import { describe, expect, it } from "bun:test";
import { app } from "../../src/index.ts";

// These requests get their own rate-limit counter, apart from the rest of the suite.
const HEADERS = { "cf-connecting-ip": "editions-routes-test" };
const get = (path: string) => app.request(path, { headers: HEADERS });

describe("GET /editions", () => {
	it("lists the 6 editions with the default and the count of changes", async () => {
		const res = await get("/editions");
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			data: { id: string; default: boolean; changes: number }[];
			meta: { default: string; variants: number };
		};
		expect(body.data.map((e) => e.id)).toEqual([
			"1955",
			"srt-2009",
			"srt-2015",
			"srt-2018",
			"srt-2021",
			"srt-2024",
		]);
		expect(body.data.filter((e) => e.default).map((e) => e.id)).toEqual(["srt-2024"]);
		expect(body.meta).toEqual({ default: "srt-2024", variants: 181 });
		// Each row counts in one edition, except 1955, which has none.
		expect(body.data.reduce((n, e) => n + e.changes, 0)).toBe(181);
	});
});

describe("GET /editions/variants", () => {
	it("gives all rows, or those of a paper, a paragraph, or a kind", async () => {
		const all = (await (await get("/editions/variants")).json()) as { meta: { total: number } };
		expect(all.meta.total).toBe(181);
		const p98 = (await (await get("/editions/variants?paper=98")).json()) as {
			data: { ref: string; applied: boolean }[];
		};
		expect(p98.data.length).toBeGreaterThan(0);
		for (const v of p98.data) expect(v.ref.startsWith("98:")).toBe(true);
		const one = (await (await get("/editions/variants?ref=27:6.4")).json()) as {
			data: { ref: string; foundBy?: string; source: { list: string | null } }[];
		};
		expect(one.data).toHaveLength(1);
		expect(one.data[0]?.foundBy).toBe("scan");
		expect(one.data[0]?.source.list).toBeNull();
		const fmt = (await (await get("/editions/variants?kind=format")).json()) as {
			data: { kind: string }[];
		};
		expect(fmt.data.length).toBe(6);
	});

	it("gives the changes adopted in one edition", async () => {
		const list = (await (await get("/editions")).json()) as {
			data: { id: string; year: number; changes: number }[];
		};
		for (const e of list.data) {
			const body = (await (await get(`/editions/variants?edition=${e.id}`)).json()) as {
				data: { year: number | null }[];
				meta: { total: number };
			};
			expect(body.meta.total).toBe(e.changes);
			for (const v of body.data) expect(v.year ?? 2009).toBe(e.year);
		}
		const none = (await (await get("/editions/variants?edition=1955")).json()) as {
			meta: { total: number };
		};
		expect(none.meta.total).toBe(0);
		// A Foundation number names the same edition, and the filters combine.
		const byNumber = (await (await get("/editions/variants?edition=1.22&kind=text")).json()) as {
			data: { year: number; kind: string }[];
		};
		for (const v of byNumber.data) expect([v.year, v.kind]).toEqual([2024, "text"]);
	});

	it("gives each change between two editions with from and to", async () => {
		type Body = { data: { year: number | null }[]; meta: { total: number; applied: number } };
		const range = (await (await get("/editions/variants?from=1955&to=srt-2015")).json()) as Body;
		const y2009 = (await (await get("/editions/variants?edition=srt-2009")).json()) as Body;
		const y2015 = (await (await get("/editions/variants?edition=srt-2015")).json()) as Body;
		expect(range.meta.total).toBe(y2009.meta.total + y2015.meta.total);
		for (const v of range.data) expect(v.year ?? 2009).toBeLessThanOrEqual(2015);
		// 119:8.9 (2009) and 58:1.7 (2015) are listed but not in the default text.
		expect(range.meta.applied).toBe(range.meta.total - 2);
		// The defaults are 1955 and srt-2024: every change.
		const all = (await (await get("/editions/variants?to=srt-2024")).json()) as Body;
		expect(all.meta.total).toBe(181);
		const late = (await (await get("/editions/variants?from=srt-2018&to=srt-2024")).json()) as Body;
		for (const v of late.data) expect([2021, 2024]).toContain(v.year as number);
	});

	it("answers 400 for a range that is empty or mixed with edition", async () => {
		for (const q of [
			"from=srt-2021&to=srt-2015",
			"from=srt-2015&to=srt-2015",
			"edition=srt-2015&to=srt-2021",
			"from=1956",
		]) {
			const res = await get(`/editions/variants?${q}`);
			expect(res.status).toBe(400);
		}
	});

	it("answers 400 unknown-edition for an edition filter it does not know", async () => {
		const res = await get("/editions/variants?edition=1956");
		expect(res.status).toBe(400);
		expect(((await res.json()) as { type: string }).type).toContain("unknown-edition");
	});

	it("answers 400 for a paper or a reference it cannot read", async () => {
		for (const q of ["paper=197", "paper=abc", "paper=098", "ref=98.3.8", "ref=1:2.0.1"]) {
			expect((await get(`/editions/variants?${q}`)).status).toBe(400);
		}
	});
});

describe("?edition= on the text routes", () => {
	const routes = [
		"/paragraphs/98:3.8",
		"/paragraphs/98:3.8/context",
		"/paragraphs/random",
		"/papers/98",
	];

	it("answers 400 unknown-edition for an id it does not know", async () => {
		for (const r of routes) {
			const res = await get(`${r}?edition=1956`);
			expect(res.status).toBe(400);
			expect(((await res.json()) as { type: string }).type).toContain("unknown-edition");
		}
	});

	it("answers 400 edition-needs-english for an older edition in another language", async () => {
		for (const r of routes) {
			const res = await get(`${r}?edition=1955&lang=es`);
			expect(res.status).toBe(400);
			expect(((await res.json()) as { type: string }).type).toContain("edition-needs-english");
		}
	});
});
