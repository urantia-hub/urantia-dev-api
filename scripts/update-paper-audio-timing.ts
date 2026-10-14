/**
 * Writes data/paper-audio-timing.json into papers.audio. Touches no other column.
 * A paper with no map in the file is set to null, so a map that later fails its check goes away.
 *
 * Usage:
 *   bun scripts/update-paper-audio-timing.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { type PaperAudioData, papers } from "../src/db/schema";

const PATH = join(import.meta.dir, "../data/paper-audio-timing.json");

async function main() {
	const { db } = getDb();
	const maps = JSON.parse(readFileSync(PATH, "utf-8")) as Record<string, PaperAudioData>;
	const rows = await db.select({ id: papers.id }).from(papers);
	let set = 0;
	for (const { id } of rows) {
		const audio = maps[id] ?? null;
		await db.update(papers).set({ audio }).where(eq(papers.id, id));
		if (audio) set++;
	}
	console.log(`${set} of ${rows.length} papers have a time map.`);
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
