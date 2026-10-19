import { afterAll, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { CORPORA } from "../../scripts/scriptures/corpora.ts";
import * as schema from "../../src/db/schema.ts";
import { corpusPages, resolveCorpus } from "../../src/lib/scripture-parallels.ts";
import {
	listWorks,
	otherWorkParallels,
	readWork,
	searchWorks,
	semanticSearchWorks,
	workParallels,
} from "../../src/lib/works.ts";

// The works on a local copy: scripts/seed-bible.ts, scripts/scriptures/seed.ts, setup-search.sql,
// setup-works-search.sql, and fill-search-words.ts for bible and works. Without them (as in CI), it skips.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const client = local ? postgres(url, { max: 1, prepare: false, onnotice: () => {} }) : null;
const db = client ? drizzle(client, { schema }) : null;
const one = async <T>(query: ReturnType<typeof sql>) =>
	((await (db as NonNullable<typeof db>).execute(query)) as unknown as T[])[0];
const ready =
	db !== null &&
	Number(
		(
			await one<{ n: number }>(
				sql`select (select count(*) from bible_verses) + (select count(*) from scripture_passages) as n`,
			)
		)?.n ?? 0,
	) > 40000;
if (!ready) await client?.end();
const suite = ready ? describe : describe.skip;

const search = (q: string, more: { work?: string; page?: number; limit?: number } = {}) =>
	searchWorks(db as never, { q, page: 0, limit: 10, urantiaParallelLimit: 3, ...more });
const refs = (r: Awaited<ReturnType<typeof search>>) => (r?.data ?? []).map((x) => x.reference);

suite("the works on a local copy", () => {
	afterAll(() => client?.end());

	it("lists the Bible and every other work", async () => {
		const works = await listWorks(db as never);
		expect(works.map((w) => w.id)).toContain("bible");
		expect(works.map((w) => w.id)).toContain("dhammapada");
		expect(works).toHaveLength(CORPORA.length + 1);
	});

	it("says what each work is: its tradition, kind, and summary", async () => {
		const works = await listWorks(db as never);
		for (const w of works) {
			expect(w.tradition.length).toBeGreaterThan(0);
			expect(["scripture", "classic", "recorded"]).toContain(w.kind);
			expect(w.summary).toMatch(/\.$/);
		}
		const bible = works.find((w) => w.id === "bible");
		expect(bible?.tradition).toBe("Jewish and Christian");
		expect(bible?.kind).toBe("scripture");
		expect(works.find((w) => w.id === "quran")?.summary).toBe("The scripture of Islam.");
	});

	it("names the tradition of the work of each result", async () => {
		const r = await search("Dhp 183");
		expect(r?.data[0]?.work.tradition).toBe("Buddhist");
	});

	it("gives a Bible reference first, with its link", async () => {
		const r = await search("John 3:16");
		expect(refs(r)).toEqual(["John 3:16"]);
		expect(r?.data[0]?.match).toBe("reference");
		expect(r?.data[0]?.url).toBe("https://ebible.org/eng-web/JHN03.htm#V16");
		expect(refs(await search("Jn 3:16-18"))).toEqual(["John 3:16", "John 3:17", "John 3:18"]);
	});

	it("gives a reference of a work, with or without its prefix", async () => {
		expect(refs(await search("Dhp 183"))).toEqual(["Dhp 183"]);
		expect(refs(await search("2.47", { work: "bhagavad-gita" }))).toEqual(["BG 2.47"]);
		expect((await search("2.47"))?.data[0]?.match).not.toBe("reference");
	});

	it("puts the exact phrase first", async () => {
		const r = await search("thy business is with the action only");
		expect(refs(r)[0]).toBe("BG 2.47");
		expect(r?.data[0]?.match).toBe("exact");
		expect(refs(await search("love your enemies")).slice(0, 3)).toEqual(
			expect.arrayContaining([expect.stringMatching(/^(Matthew 5:44|Luke 6:27)$/)]),
		);
	});

	it("keeps to one work", async () => {
		const bible = await search("love", { work: "bible" });
		expect(bible?.data.every((x) => x.work.id === "bible")).toBe(true);
		const dhp = await search("mind", { work: "dhammapada" });
		expect(dhp?.meta.total).toBeGreaterThan(0);
		expect(dhp?.data.every((x) => x.work.id === "dhammapada")).toBe(true);
		expect(await search("love", { work: "no-such-work" })).toBeNull();
	});

	it("fixes a typo and says so", async () => {
		const r = await search("love your enemeis");
		expect(r?.meta.didYouMean).toBe("love your enemies");
		expect(r?.data[0]?.match).toBe("near");
	});

	it("answers common words and syntax with no error", async () => {
		expect((await search("the of and"))?.meta.total).toBe(0);
		await search("a & b | !c:* 'd' \\e (f)");
		await search("John 99:99");
	});

	it("pages with no unit twice", async () => {
		const seen = new Set<string>();
		for (const page of [0, 1, 2]) {
			for (const x of (await search("faith", { page, limit: 20 }))?.data ?? []) {
				const key = `${x.work.id} ${x.reference}`;
				expect(seen.has(key)).toBe(false);
				seen.add(key);
			}
		}
		expect(seen.size).toBe(60);
	});

	it("gives each result a link and its Urantia paragraphs", async () => {
		for (const x of (await search("mind"))?.data ?? []) {
			expect(x).toHaveProperty("url");
			expect(x.urantiaParallels).toBeArray();
		}
	});

	it("gives the pages of a work: subdivisions for a work with three levels", async () => {
		const pages = async (name: string) =>
			corpusPages(db as never, (await resolveCorpus(db as never, name)) as never);
		const rv = await pages("rig-veda");
		expect(rv).toHaveLength(1027);
		expect(rv[0]).toMatchObject({
			division: 1,
			subdivision: 1,
			firstRef: "RV 1.1.1",
			lastRef: "RV 1.1.9",
			passageCount: 9,
		});
		const dhp = await pages("dhammapada");
		expect(dhp).toHaveLength(26);
		expect(dhp[1]).toMatchObject({
			division: 2,
			subdivision: null,
			title: "On Earnestness",
			firstRef: "Dhp 21",
			lastRef: "Dhp 32",
			passageCount: 12,
		});
	});

	// Isa has one number for each verse ("Isa 5"), in a work of three levels: it is one page, not 18.
	it("gives a division of single-number refs as one page", async () => {
		const up = await corpusPages(
			db as never,
			(await resolveCorpus(db as never, "upanishads")) as never,
		);
		const isa = up.filter((p) => p.firstRef.startsWith("Isa "));
		expect(isa).toHaveLength(1);
		expect(isa[0]).toMatchObject({
			subdivision: null,
			firstRef: "Isa 1",
			lastRef: "Isa 18",
			passageCount: 18,
		});
		expect(
			up.filter((p) => p.firstRef.startsWith("Khandogya ")).every((p) => p.subdivision !== null),
		).toBe(true);
	});

	it("reads the longest page whole", async () => {
		expect(await readWork(db as never, "Quran 2", "quran")).toHaveLength(286);
	});

	it("gives no parallels of other works while their table does not exist", async () => {
		await (client as postgres.Sql).unsafe("DROP TABLE IF EXISTS scripture_work_parallels");
		const found = await otherWorkParallels(db as never, "dhammapada", "Dhp 21");
		expect(found).toMatchObject({ reference: "Dhp 21", parallels: [] });
	});

	it("gives the nearest passages of the other works and the Bible, nearest first", async () => {
		const pg = client as postgres.Sql;
		await pg.unsafe(readFileSync("scripts/scriptures/create-work-parallels.sql", "utf8"));
		const [own] = await pg<{ chunk_id: string }[]>`
			SELECT chunk_id FROM scripture_passages WHERE id = 'dhammapada-muller-1881:Dhp 21'`;
		const [koran] = await pg<{ id: string }[]>`
			SELECT id FROM scripture_chunks WHERE corpus_id = 'koran-pickthall-1930' ORDER BY sort_start LIMIT 1`;
		// A local copy can have no Bible chunks: the test brings one of its own.
		await pg`INSERT INTO bible_chunks (id, book_code, chapter, verse_start, verse_end, text)
			VALUES ('test:Gen.1.1-2', 'Gen', 1, 1, 2, 'In the beginning, God created the heavens and the earth.')
			ON CONFLICT (id) DO NOTHING`;
		const bible = { id: "test:Gen.1.1-2" };
		await pg`INSERT INTO scripture_work_parallels ${pg([
			{
				chunk_id: own?.chunk_id,
				rank: 1,
				other_bible_chunk_id: bible?.id,
				other_chunk_id: null,
				similarity: 0.7,
			},
			{
				chunk_id: own?.chunk_id,
				rank: 2,
				other_chunk_id: koran?.id,
				other_bible_chunk_id: null,
				similarity: 0.6,
			},
		])}`;
		const found = await otherWorkParallels(db as never, "dhammapada", "Dhp 21");
		if (!found || found === "many") throw new Error("no unit");
		expect(found.chunk.references).toContain("Dhp 21");
		expect(found.parallels.map((p) => p.work.id)).toEqual(["bible", "quran"]);
		expect(found.parallels[0]?.reference).toBe("Genesis 1:1-2");
		expect(found.parallels[0]?.similarity).toBeCloseTo(0.7, 5);
		expect(found.parallels[1]?.reference).toMatch(/^Quran 1/);
		expect(found.parallels[1]?.work.tradition).toBe("Muslim");
		await pg.unsafe("DROP TABLE scripture_work_parallels");
		await pg`DELETE FROM bible_chunks WHERE id = 'test:Gen.1.1-2'`;
	});

	it("reads a part of a work", async () => {
		expect((await readWork(db as never, "Dhp 1-3", "dhammapada"))?.map((u) => u.reference)).toEqual(
			["Dhp 1", "Dhp 2", "Dhp 3"],
		);
		expect(await readWork(db as never, "Dhp 1", "bible")).toBeNull();
		expect(await workParallels(db as never, "bible", "John 3")).toBe("many");
	});

	it("gives the nearest chunk first in a semantic search", async () => {
		const row = await one<{ e: string }>(
			sql`select embedding_small::text as e from scripture_chunks where id = 'dhammapada-muller-1881:Dhp 3'`,
		);
		const r = await semanticSearchWorks(db as never, {
			q: "hatred does not cease by hatred",
			work: "dhammapada",
			page: 0,
			limit: 5,
			urantiaParallelLimit: 3,
			embed: async () => JSON.parse(row?.e ?? "[]"),
		});
		if (!r || r === "embedding") throw new Error("no result");
		expect(r.data[0]?.reference).toBe("Dhp 3-5");
		expect(r.data[0]?.strength).toBe("strong");
		expect(r.meta.total).toBeLessThanOrEqual(100);
		expect(r.meta.totalPages).toBe(Math.ceil(r.meta.total / 5));
		expect(r.meta.related).toBeLessThanOrEqual(r.meta.total);
		expect(r.data.every((x) => x.work.id === "dhammapada")).toBe(true);
	});
});
