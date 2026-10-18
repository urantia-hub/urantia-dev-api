// Fills `search_words` with each word of one body of text and its count, for near words in search.
// Usage: DATABASE_URL=... bun scripts/fill-search-words.ts papers|bible|works
// Re-runnable: it replaces the words of that source in one transaction. Run it after a reseed.
import postgres from "postgres";
import { normalizedSql } from "../src/lib/search-text.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

// The normalized text of each source, so the words match a normalized query.
const words = (table: string) =>
	`select to_tsvector('simple', ${normalizedSql("text")}) from ${table}`;
const SOURCES: Record<string, string> = {
	papers: words("paragraphs"),
	bible: words("bible_verses"),
	works: words("scripture_passages"),
};

const source = process.argv[2] ?? "";
const query = SOURCES[source];
if (!query) {
	console.error(`Name one source: ${Object.keys(SOURCES).join(", ")}`);
	process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1, onnotice: () => {} });
await sql.begin(async (tx) => {
	await tx`delete from search_words where source = ${source}`;
	await tx`
		insert into search_words (source, word, n)
		select ${source}, word, nentry from ts_stat(${query})
		where length(word) between 2 and 40`;
});
const [row] = await sql`select count(*)::int as n from search_words where source = ${source}`;
console.log(`${source}: ${row?.n} words`);
await sql.end();
