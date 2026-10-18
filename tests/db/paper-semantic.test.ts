import { afterAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../src/db/schema.ts";
import { MAX_RESULTS, semanticSearchPapers } from "../../src/lib/paper-semantic.ts";

// The semantic rules on a local copy of the Papers with a vector on each paragraph (any vectors:
// the query takes the vector of a known paragraph). Without them (as in CI), the suite skips.
const url = process.env.TEST_DATABASE_URL ?? "";
const local = /^postgres(ql)?:\/\/[^@/]*@(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
const client = local ? postgres(url, { max: 1, prepare: false, onnotice: () => {} }) : null;
const db = client ? drizzle(client, { schema }) : null;
const one = async <T>(query: ReturnType<typeof sql>) =>
	((await (db as NonNullable<typeof db>).execute(query)) as unknown as T[])[0];
const ready =
	db !== null &&
	Number(
		(await one<{ n: number }>(sql`select count(embedding)::int as n from paragraphs`))?.n ?? 0,
	) > 14000;
if (!ready) await client?.end();
const suite = ready ? describe : describe.skip;

const vectorOf = async (ref: string) => {
	const row = await one<{ e: string }>(
		sql`select embedding::text as e from paragraphs where standard_reference_id = ${ref}`,
	);
	return JSON.parse(row?.e ?? "null") as number[];
};
const textOf = async (ref: string) =>
	(
		await one<{ t: string }>(
			sql`select text as t from paragraphs where standard_reference_id = ${ref}`,
		)
	)?.t ?? "";

suite("semanticSearchPapers on the Papers", () => {
	afterAll(() => client?.end());

	it("gives a reference with no vector call", async () => {
		const r = await semanticSearchPapers(db as never, {
			q: "99:1.1",
			page: 0,
			limit: 10,
			embed: () => {
				throw new Error("no vector for a reference");
			},
		});
		expect(r?.data.map((p) => p.standardReferenceId)).toEqual(["99:1.1"]);
		expect(r?.data[0]?.match).toBe("reference");
	});

	it("gives the nearest paragraph first, and at most 100 in all", async () => {
		const embed = async () => vectorOf("56:10.21");
		const first = await semanticSearchPapers(db as never, { q: "love", page: 0, limit: 20, embed });
		expect(first?.data[0]?.standardReferenceId).toBe("56:10.21");
		expect(first?.data[0]?.match).toBe("similar");
		expect(first?.meta.total).toBe(MAX_RESULTS);
		expect(first?.meta.totalPages).toBe(MAX_RESULTS / 20);
		expect(first?.meta.related).toBeLessThanOrEqual(MAX_RESULTS);
		const seen = new Set<string>();
		for (let page = 0; page < 6; page++) {
			const r = await semanticSearchPapers(db as never, { q: "love", page, limit: 20, embed });
			for (const p of r?.data ?? []) {
				expect(seen.has(p.id)).toBe(false);
				seen.add(p.id);
			}
		}
		expect(seen.size).toBe(MAX_RESULTS);
	});

	it("puts a pasted paragraph first as exact", async () => {
		const text = await textOf("111:7.5");
		const r = await semanticSearchPapers(db as never, {
			q: text,
			page: 0,
			limit: 10,
			embed: async () => vectorOf("1:0.1"),
		});
		expect(r?.data[0]?.standardReferenceId).toBe("111:7.5");
		expect(r?.data[0]?.match).toBe("exact");
		expect(r?.data[1]?.standardReferenceId).toBe("1:0.1");
		expect(r?.meta.related).toBeGreaterThanOrEqual(1);
	});

	it("is null when there is no vector", async () => {
		expect(
			await semanticSearchPapers(db as never, {
				q: "x",
				page: 0,
				limit: 5,
				embed: async () => null,
			}),
		).toBeNull();
	});
});
