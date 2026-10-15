import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const sql = postgres(DATABASE_URL);

console.log("Dropping existing search_vector column...");
await sql`ALTER TABLE paragraphs DROP COLUMN IF EXISTS search_vector`;

console.log("Adding search_vector as GENERATED ALWAYS AS stored column...");
await sql.unsafe(`
  ALTER TABLE paragraphs ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED
`);

console.log("Creating GIN index...");
await sql`CREATE INDEX IF NOT EXISTS paragraphs_fts_gin_idx ON paragraphs USING GIN (search_vector)`;

// Verify
const check = await sql`
  SELECT count(*) as total,
         count(search_vector) as with_sv
  FROM paragraphs
`;
console.log(
	`\nVerification: ${check[0]?.total} paragraphs, ${check[0]?.with_sv} with search_vector populated`,
);

await sql.end();
console.log("FTS setup complete.");
