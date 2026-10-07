// Applies create-tables.sql once. It refuses to run when a scripture_* table exists.
// Run: DATABASE_URL=... bun scripts/scriptures/apply-tables.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const sql = postgres(DATABASE_URL, { max: 1 });

const existing = await sql<{ table_name: string }[]>`
	SELECT table_name FROM information_schema.tables
	WHERE table_schema = 'public' AND table_name LIKE 'scripture\\_%'`;
if (existing.length)
	throw new Error(`Already present: ${existing.map((t) => t.table_name).join(", ")}`);
await sql.unsafe(readFileSync(join(import.meta.dir, "create-tables.sql"), "utf8"));
const rls = await sql<{ relname: string; relrowsecurity: boolean }[]>`
	SELECT relname, relrowsecurity FROM pg_class
	WHERE relname LIKE 'scripture\\_%' AND relkind = 'r' ORDER BY relname`;
console.table(rls);
await sql.end();
