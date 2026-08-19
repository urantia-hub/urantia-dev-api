import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const sql = postgres(DATABASE_URL);

const setupSql = readFileSync(
	join(import.meta.dir, "setup-rls.sql"),
	"utf-8",
);

console.log("Enabling RLS on all public tables...");
await sql.unsafe(setupSql);

const result = await sql`
  SELECT tablename, rowsecurity
  FROM pg_tables
  WHERE schemaname = 'public'
  ORDER BY tablename
`;

const off = result.filter((r) => !r.rowsecurity);
console.log(`\n${result.length} public tables, ${off.length} still without RLS.`);
if (off.length > 0) {
	console.log("Without RLS:", off.map((r) => r.tablename).join(", "));
}

await sql.end();
console.log("RLS setup complete.");
