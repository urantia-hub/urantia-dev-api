import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { type PaperSearchOptions, searchPapers } from "../../src/lib/paper-search.ts";

// The search queries on a local copy of the Papers: `bun scripts/seed.ts`, scripts/setup-fts.sql,
// scripts/setup-search.sql, and `bun scripts/fill-search-words.ts papers` on TEST_DATABASE_URL.
// Without the Papers there (as in CI), the suite skips.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const client = local ? postgres(url, { max: 1, prepare: false, onnotice: () => {} }) : null;
const db = client ? drizzle(client, { schema }) : null;
const seeded =
	db !== null &&
	Number(
		(
			(await db.execute(sql`select count(*)::int as n from paragraphs`)) as unknown as {
				n: number;
			}[]
		)[0]?.n ?? 0,
	) > 14000;
const suite = seeded ? describe : describe.skip;
if (!seeded) await client?.end();

const search = (q: string, more: Partial<PaperSearchOptions> = {}) =>
	searchPapers(db as never, { q, type: "auto", page: 0, limit: 20, ...more });
const refs = (r: Awaited<ReturnType<typeof search>>) => r.data.map((p) => p.standardReferenceId);

suite("searchPapers on the Papers", () => {
	afterAll(() => client?.end());

	it("gives the paragraph of a reference first", async () => {
		const r = await search("68:6.3");
		expect(refs(r)).toEqual(["68:6.3"]);
		expect(r.data[0]?.match).toBe("reference");
		expect((await search('"103:2.1"')).data[0]?.standardReferenceId).toBe("103:2.1");
	});

	it("gives the paragraphs of a section in order", async () => {
		const r = await search("103:2");
		expect(r.meta.total).toBe(10);
		expect(refs(r)[0]).toBe("103:2.1");
		expect(refs(r).every((x) => x.startsWith("103:2."))).toBe(true);
	});

	it("gives nothing for a reference that does not exist", async () => {
		expect((await search("68:99.1")).meta.total).toBe(0);
	});

	it("puts the exact phrase first", async () => {
		const r = await search("such a life on such a planet");
		expect(refs(r)[0]).toBe("111:7.5");
		expect(r.data[0]?.match).toBe("exact");
	});

	it("finds a phrase with one word changed", async () => {
		const r = await search("the urge of ambition opposed by animal laziness");
		expect(refs(r).slice(0, 3)).toContain("111:7.5");
		expect(r.data.find((p) => p.standardReferenceId === "111:7.5")?.match).toBe("most");
	});

	it("finds a phrase with a typo, and says what it read", async () => {
		const r = await search("the universal fahter is the god of all creation");
		expect(refs(r)[0]).toBe("1:0.1");
		expect(r.data[0]?.match).toBe("near");
		expect(r.meta.didYouMean).toBe("the universal father is the god of all creation");
	});

	it("labels a paragraph with only some words as most in or mode", async () => {
		const r = await searchPapers(db as never, {
			q: "melchizedek salem",
			type: "or",
			page: 0,
			limit: 100,
		});
		for (const p of r.data) {
			const text = p.text.toLowerCase();
			const both = text.includes("melchizedek") && text.includes("salem");
			if (p.match === "all") expect(both).toBe(true);
		}
		expect(r.data.some((p) => p.match === "most")).toBe(true);
	});

	it("marks the start of the last word after a typo fix", async () => {
		const r = await search("spirt grav");
		expect(r.meta.didYouMean).toBe("spirit grav");
		expect(r.data[0]?.htmlText).toMatch(/urantia-dev-highlighted>[Gg]ravity/);
	});

	it("checks only the first 12 long words for a typo", async () => {
		const long = Array.from({ length: 14 }, (_, i) => `qqqq${String.fromCharCode(97 + i)}`);
		const r = await search([...long, "fahter"].join(" "));
		expect(r.meta.didYouMean ?? "").not.toContain("father");
	});

	it("finds a word from its first letters", async () => {
		const r = await search("agondon");
		expect(r.meta.total).toBeGreaterThan(0);
		expect(r.data[0]?.text.toLowerCase()).toContain("agondonter");
	});

	it("matches a number written with a comma", async () => {
		const r = await search("100,000 worlds");
		expect(refs(r)).toContain("15:2.20");
		expect(r.data.find((p) => p.standardReferenceId === "15:2.20")?.match).toBe("exact");
	});

	it("answers a query of common words or marks with no error", async () => {
		expect((await search("the of and")).meta.total).toBe(0);
		await search("a & b | !c:* 'd' \\e (f)");
		await search("197:1.1");
	});

	it("names another work in meta.see", async () => {
		expect((await search("dhammapada")).meta.see?.work).toBe("dhammapada");
		expect((await search("soul")).meta.see).toBeUndefined();
	});

	it("pages with no paragraph twice", async () => {
		const seen = new Set<string>();
		for (const page of [0, 1, 2]) {
			for (const id of refs(await search("faith", { page }))) {
				expect(seen.has(id)).toBe(false);
				seen.add(id);
			}
		}
		expect(seen.size).toBe(60);
	});

	it("keeps the meaning of `and`", async () => {
		const r = await search("faith hope", { type: "and", limit: 100 });
		const [row] = (await (db as NonNullable<typeof db>).execute(
			sql`select count(*)::int as n from paragraphs where search_vector @@ to_tsquery('english', 'faith & hope')`,
		)) as unknown as { n: number }[];
		expect(r.meta.total).toBe(row?.n ?? -1);
		expect(r.data.every((p) => p.match === "exact" || p.match === "all")).toBe(true);
	});
});
