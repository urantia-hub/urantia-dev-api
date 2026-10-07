// Applies alter-phase2.sql once. It refuses to run when the new columns exist.
// Run: DATABASE_URL=... bun scripts/scriptures/apply-alter-phase2.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(DATABASE_URL, { max: 1 });

const existing = await sql<{ column_name: string }[]>`
	SELECT column_name FROM information_schema.columns
	WHERE table_schema = 'public' AND table_name IN ('scripture_corpora', 'scripture_passages')
	  AND column_name IN ('ref_levels', 'notes', 'subdivision')`;
if (existing.length)
	throw new Error(`Already present: ${existing.map((c) => c.column_name).join(", ")}`);
await sql.unsafe(readFileSync(join(import.meta.dir, "alter-phase2.sql"), "utf8"));
console.table(
	await sql`SELECT id, ref_levels, urantia_section FROM scripture_corpora ORDER BY sort_order`,
);
await sql.end();
