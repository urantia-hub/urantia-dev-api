/**
 * Update the audio column in the paragraphs table from the audio manifest.
 * This is a lightweight alternative to a full reseed — only touches the audio column.
 *
 * Usage:
 *   bun run scripts/update-audio-manifest-db.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../src/db/client";
import { paragraphs } from "../src/db/schema";
import { eq } from "drizzle-orm";

const { db } = getDb();

const MANIFEST_PATH = join(import.meta.dir, "../data/audio-manifest.json");

type AudioManifest = Record<
	string,
	Record<string, Record<string, { format: string; url: string }>>
>;

async function main() {
	const manifest: AudioManifest = JSON.parse(
		readFileSync(MANIFEST_PATH, "utf-8"),
	);

	const globalIds = Object.keys(manifest);
	console.log(`Audio manifest loaded: ${globalIds.length} entries`);

	let updated = 0;
	let skipped = 0;
	const batchSize = 100;

	for (let i = 0; i < globalIds.length; i += batchSize) {
		const batch = globalIds.slice(i, i + batchSize);

		const updates = batch.map((globalId) => {
			const audio = manifest[globalId];
			return db
				.update(paragraphs)
				.set({ audio })
				.where(eq(paragraphs.globalId, globalId));
		});

		const results = await Promise.all(updates);
		updated += results.length;

		if ((i / batchSize) % 10 === 0) {
			console.log(
				`  Updated ${updated}/${globalIds.length} (${((updated / globalIds.length) * 100).toFixed(1)}%)`,
			);
		}
	}

	console.log(`\nDone: ${updated} paragraphs updated with audio manifest`);
}

main().catch((err) => {
	console.error("Failed:", err);
	process.exit(1);
});
