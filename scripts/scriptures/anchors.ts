// Fills `scripture_chunks.anchor`: for each passage, words that are in one place of its public page.
// Run after a work is loaded or its page address changes:
//   DATABASE_URL=... bun scripts/scriptures/anchors.ts          (writes)
//   DRY=1 DATABASE_URL=... bun scripts/scriptures/anchors.ts    (counts only)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { workPage } from "../../src/lib/parallel-links.ts";
import { findAnchor, pageText } from "./anchor.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required");
const DRY = process.env.DRY === "1";
const sql = postgres(DATABASE_URL, { max: 2 });

if (!DRY) await sql.unsafe(readFileSync(join(import.meta.dir, "alter-anchors.sql"), "utf8"));

const pages = new Map<string, Promise<string | null>>();
const page = (url: string) => {
	let found = pages.get(url);
	if (!found) {
		found = fetch(url, { headers: { "user-agent": "Mozilla/5.0 (urantia.dev anchors)" } })
			.then(async (res) => (res.ok ? pageText(await res.text()) : null))
			.catch(() => null);
		pages.set(url, found);
	}
	return found;
};

const chunks = await sql<{ id: string; corpus_id: string; label: string; text: string }[]>`
	SELECT id, corpus_id, label, text FROM scripture_chunks ORDER BY corpus_id, sort_start`;
const counts = new Map<string, { all: number; found: number; noPage: number }>();
const updates: { id: string; anchor: string | null }[] = [];
for (const chunk of chunks) {
	const count = counts.get(chunk.corpus_id) ?? { all: 0, found: 0, noPage: 0 };
	counts.set(chunk.corpus_id, count);
	count.all += 1;
	const url = workPage(chunk.corpus_id, chunk.label);
	const text = url ? await page(url) : null;
	if (text === null) count.noPage += 1;
	const anchor = text === null ? null : findAnchor(text, chunk.text);
	if (anchor) count.found += 1;
	updates.push({ id: chunk.id, anchor });
}
for (const [work, c] of counts)
	console.log(
		`${work}: ${c.all} passages | anchor ${c.found} | page only ${c.all - c.found} | no page ${c.noPage}`,
	);

if (!DRY) {
	for (let i = 0; i < updates.length; i += 500) {
		const part = updates.slice(i, i + 500);
		await sql`
			UPDATE scripture_chunks AS c SET anchor = v.anchor
			FROM (SELECT * FROM unnest(${sql.array(part.map((u) => u.id))}::text[], ${sql.array(part.map((u) => u.anchor))}::text[]) AS t(id, anchor)) AS v
			WHERE c.id = v.id`;
	}
	console.log(`wrote ${updates.length} rows`);
}
await sql.end();
