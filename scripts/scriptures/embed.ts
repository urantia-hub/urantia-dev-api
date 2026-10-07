// Embeds scripture_chunks with text-embedding-3-large (for parallels) and
// text-embedding-3-small (for live search). Re-runnable: it embeds only the
// chunks that have no embedding.
// Run: DATABASE_URL=... OPENAI_API_KEY=... bun scripts/scriptures/embed.ts
import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required");

const sql = postgres(DATABASE_URL, { max: 2 });
const BATCH = 128;

async function embed(model: string, dims: number, input: string[]): Promise<number[][]> {
	const res = await fetch("https://api.openai.com/v1/embeddings", {
		method: "POST",
		headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({ model, input }),
	});
	if (!res.ok) throw new Error(`OpenAI ${model} ${res.status}: ${await res.text()}`);
	const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
	const out = json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
	if (out.length !== input.length || out.some((e) => e.length !== dims)) {
		throw new Error(`OpenAI ${model}: unexpected response shape`);
	}
	return out;
}

const rows = await sql<{ id: string; text: string }[]>`
	SELECT id, text FROM scripture_chunks
	WHERE embedding IS NULL OR embedding_small IS NULL ORDER BY id`;
console.log(`${rows.length} chunks to embed`);
for (let i = 0; i < rows.length; i += BATCH) {
	const batch = rows.slice(i, i + BATCH);
	const texts = batch.map((r) => r.text);
	const [large, small] = await Promise.all([
		embed("text-embedding-3-large", 3072, texts),
		embed("text-embedding-3-small", 1536, texts),
	]);
	await sql.begin(async (tx) => {
		for (const [j, r] of batch.entries()) {
			await tx`
				UPDATE scripture_chunks SET
					embedding = ${`[${(large[j] as number[]).join(",")}]`}::vector,
					embedding_small = ${`[${(small[j] as number[]).join(",")}]`}::vector,
					embedding_model = 'text-embedding-3-large'
				WHERE id = ${r.id}`;
		}
	});
	console.log(`  ${Math.min(i + BATCH, rows.length)} / ${rows.length}`);
}
await sql.end();
