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
