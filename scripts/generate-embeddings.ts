import { existsSync, readFileSync, writeFileSync } from "node:fs";
import OpenAI from "openai";
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
	console.error("OPENAI_API_KEY environment variable is required");
	process.exit(1);
}

const EMBEDDINGS_PATH = "data/embeddings.json";
const BATCH_SIZE = 100;

const sql = postgres(DATABASE_URL);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// ── Phase A: Generate embeddings & save locally ──

console.log("Fetching paragraphs from database...");
const rows = await sql`SELECT id, global_id, text FROM paragraphs ORDER BY sort_id`;
console.log(`Found ${rows.length} paragraphs.`);

// Load existing embeddings for resumability
let embeddings: Record<string, number[]> = {};
if (existsSync(EMBEDDINGS_PATH)) {
	console.log("Loading existing embeddings from disk for resumability...");
	embeddings = JSON.parse(readFileSync(EMBEDDINGS_PATH, "utf-8"));
	console.log(`Loaded ${Object.keys(embeddings).length} existing embeddings.`);
}

const toEmbed = rows.filter((r) => !embeddings[r.global_id]);
console.log(`${toEmbed.length} paragraphs need embeddings.\n`);

for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
	const batch = toEmbed.slice(i, i + BATCH_SIZE);
	const texts = batch.map((r) => r.text);

	const response = await openai.embeddings.create({
		model: "text-embedding-3-small",
		input: texts,
	});

	for (let j = 0; j < batch.length; j++) {
		embeddings[batch[j]!.global_id] = response.data[j]!.embedding;
	}

	const progress = Math.min(i + BATCH_SIZE, toEmbed.length);
	console.log(`Embedded ${progress}/${toEmbed.length} paragraphs`);

	// Save after each batch for crash safety
	writeFileSync(EMBEDDINGS_PATH, JSON.stringify(embeddings));
}

console.log(
	`\nPhase A complete. ${Object.keys(embeddings).length} embeddings saved to ${EMBEDDINGS_PATH}\n`,
);

// ── Phase B: Insert embeddings into database ──

console.log("Inserting embeddings into database...");

const globalIds = Object.keys(embeddings);
let updated = 0;

for (let i = 0; i < globalIds.length; i += BATCH_SIZE) {
	const batch = globalIds.slice(i, i + BATCH_SIZE);

	// Skip rows that already have embeddings
	const needsUpdate =
		await sql`SELECT global_id FROM paragraphs WHERE global_id = ANY(${batch}) AND embedding IS NULL`;

	for (const row of needsUpdate) {
		const vector = `[${embeddings[row.global_id]!.join(",")}]`;
		await sql`UPDATE paragraphs SET embedding = ${vector}::vector WHERE global_id = ${row.global_id}`;
	}

	updated += needsUpdate.length;
	const progress = Math.min(i + BATCH_SIZE, globalIds.length);
	console.log(`Processed ${progress}/${globalIds.length} (updated ${updated} rows)`);
}

// Verify
const check = await sql`
  SELECT count(*) as total,
         count(embedding) as with_embedding
  FROM paragraphs
`;
console.log(
	`\nVerification: ${check[0]?.total} paragraphs, ${check[0]?.with_embedding} with embeddings populated`,
);

await sql.end();
console.log("Done.");
