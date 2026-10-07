// Applies create-scores-tables.sql once. It refuses to run when either table exists.
// Run: DATABASE_URL=... bun scripts/scriptures/apply-scores-tables.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(DATABASE_URL, { max: 1 });

const existing = await sql<{ table_name: string }[]>`
	SELECT table_name FROM information_schema.tables
	WHERE table_schema = 'public' AND table_name IN ('paragraph_scripture_scores', 'scripture_mutual_pairs')`;
if (existing.length)
	throw new Error(`Already present: ${existing.map((t) => t.table_name).join(", ")}`);
await sql.unsafe(readFileSync(join(import.meta.dir, "create-scores-tables.sql"), "utf8"));
console.table(
	await sql`SELECT relname, relrowsecurity FROM pg_class
		WHERE relname IN ('paragraph_scripture_scores', 'scripture_mutual_pairs') AND relkind = 'r'`,
);
await sql.end();
