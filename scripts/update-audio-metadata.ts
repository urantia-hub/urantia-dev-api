/**
 * Updates the audio JSONB column for all paragraphs with the latest manifest data.
 * Run this after regenerating the audio manifest with duration/bitrate/fileSize.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { paragraphs } from "../src/db/schema.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL is required");
	process.exit(1);
}

const manifestPath = join(import.meta.dir, "../data/audio-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

const client = postgres(DATABASE_URL, { max: 1, idle_timeout: 5 });
const db = drizzle(client);

async function updateAudio() {
	const globalIds = Object.keys(manifest);
	console.log(`Updating audio for ${globalIds.length} paragraphs...`);

	let updated = 0;
	let skipped = 0;

	// Process in batches of 100
	for (let i = 0; i < globalIds.length; i += 100) {
		const batch = globalIds.slice(i, i + 100);

		for (const globalId of batch) {
			const audioData = manifest[globalId];
			if (!audioData) {
				skipped++;
				continue;
			}

			const result = await db
				.update(paragraphs)
				.set({ audio: audioData })
				.where(eq(paragraphs.globalId, globalId));

			updated++;
		}

		if ((i + 100) % 1000 === 0 || i + 100 >= globalIds.length) {
			console.log(`  Progress: ${Math.min(i + 100, globalIds.length)} / ${globalIds.length}`);
		}
	}

	console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);
	await client.end();
}

updateAudio().catch(console.error);
