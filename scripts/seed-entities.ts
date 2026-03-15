import { readFileSync } from "node:fs";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { inArray, like, sql } from "drizzle-orm";
import postgres from "postgres";
import { entities, paragraphEntities, paragraphs } from "../src/db/schema.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const SEED_PATH =
	process.env.SEED_ENTITIES_PATH ??
	join(import.meta.dir, "../data/entities/seed-entities.json");

type SeedEntity = {
	id: string;
	name: string;
	type: string;
	aliases: string[];
	description: string;
	seeAlso: string[];
	citations: string[];
};

const client = postgres(DATABASE_URL);
const db = drizzle(client);

async function seed() {
	console.log(`Seeding entities from: ${SEED_PATH}`);

	const rawData: SeedEntity[] = JSON.parse(readFileSync(SEED_PATH, "utf-8"));
	console.log(`Loaded ${rawData.length} entities`);

	// --- 1. Insert entities in batches ---
	console.log("\n--- Inserting entities ---");
	for (let i = 0; i < rawData.length; i += 500) {
		const batch = rawData.slice(i, i + 500);
		const values = batch.map((e) => ({
			id: e.id,
			name: e.name,
			type: e.type,
			aliases: e.aliases.length > 0 ? e.aliases : null,
			description: e.description || null,
			seeAlso: e.seeAlso.length > 0 ? e.seeAlso : null,
			citationCount: e.citations.length,
		}));
		await db
			.insert(entities)
			.values(values)
			.onConflictDoUpdate({
				target: entities.id,
				set: {
					description: sql`excluded.description`,
				},
			});
		console.log(`  Upserted entities ${i + 1}–${Math.min(i + 500, rawData.length)}`);
	}

	// --- 2. Build junction table rows ---
	console.log("\n--- Building paragraph_entities junction table ---");

	// Collect all unique citation refs
	const allCitations = new Set<string>();
	for (const e of rawData) {
		for (const c of e.citations) {
			allCitations.add(c);
		}
	}
	console.log(`  ${allCitations.size} unique citation references`);

	// Separate exact refs (e.g. "77:8.2") from section-only refs (e.g. "76:2")
	const exactRefs: string[] = [];
	const sectionRefs: string[] = [];
	for (const ref of allCitations) {
		if (/^\d+:\d+\.\d+$/.test(ref)) {
			exactRefs.push(ref);
		} else if (/^\d+:\d+$/.test(ref)) {
			sectionRefs.push(ref);
		} else {
			console.warn(`  Skipping unrecognized citation format: ${ref}`);
		}
	}

	// Bulk resolve exact refs
	const refToParaId = new Map<string, string[]>();

	// Process exact refs in chunks
	for (let i = 0; i < exactRefs.length; i += 500) {
		const chunk = exactRefs.slice(i, i + 500);
		const rows = await db
			.select({
				id: paragraphs.id,
				standardReferenceId: paragraphs.standardReferenceId,
			})
			.from(paragraphs)
			.where(inArray(paragraphs.standardReferenceId, chunk));

		for (const row of rows) {
			const existing = refToParaId.get(row.standardReferenceId) ?? [];
			existing.push(row.id);
			refToParaId.set(row.standardReferenceId, existing);
		}
	}
	console.log(`  Resolved ${refToParaId.size} exact references`);

	// Resolve section-only refs (e.g. "76:2" → all paragraphs matching "76:2.%")
	for (const ref of sectionRefs) {
		const rows = await db
			.select({
				id: paragraphs.id,
				standardReferenceId: paragraphs.standardReferenceId,
			})
			.from(paragraphs)
			.where(like(paragraphs.standardReferenceId, `${ref}.%`));

		for (const row of rows) {
			const existing = refToParaId.get(row.standardReferenceId) ?? [];
			existing.push(row.id);
			refToParaId.set(row.standardReferenceId, existing);
		}

		// Also map the section ref itself to all found paragraph IDs
		if (rows.length > 0) {
			refToParaId.set(
				ref,
				rows.map((r) => r.id),
			);
		}
	}
	console.log(`  Resolved ${sectionRefs.length} section references`);

	// Build all junction rows
	const junctionRows: { paragraphId: string; entityId: string }[] = [];
	const seen = new Set<string>();

	for (const entity of rawData) {
		for (const citation of entity.citations) {
			const paraIds = refToParaId.get(citation) ?? [];
			for (const paraId of paraIds) {
				const key = `${paraId}|${entity.id}`;
				if (!seen.has(key)) {
					seen.add(key);
					junctionRows.push({ paragraphId: paraId, entityId: entity.id });
				}
			}
		}
	}

	console.log(`  ${junctionRows.length} junction rows to insert`);

	// Batch insert junction rows
	for (let i = 0; i < junctionRows.length; i += 500) {
		const batch = junctionRows.slice(i, i + 500);
		await db.insert(paragraphEntities).values(batch).onConflictDoNothing();
		if ((i / 500) % 20 === 0) {
			console.log(`  Inserted junction rows ${i + 1}–${Math.min(i + 500, junctionRows.length)}`);
		}
	}

	console.log("\n--- Entity seed complete ---");
	console.log(`  Entities: ${rawData.length}`);
	console.log(`  Junction rows: ${junctionRows.length}`);

	await client.end();
}

seed().catch((err) => {
	console.error("Entity seed failed:", err);
	process.exit(1);
});
