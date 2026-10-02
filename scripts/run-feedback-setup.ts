import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

// Silence the "already exists, skipping" notices on a re-run.
const sql = postgres(DATABASE_URL, { onnotice: () => {} });

const setupSql = readFileSync(join(import.meta.dir, "setup-feedback.sql"), "utf-8");

console.log("Creating the feedback table...");
await sql.unsafe(setupSql);

const result = await sql`
  SELECT rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public' AND tablename = 'feedback'
`;

await sql.end();

if (result[0]?.rowsecurity !== true) {
	console.error("The feedback table is missing or has no RLS.");
	process.exit(1);
}
console.log("Feedback table ready, RLS enabled.");
