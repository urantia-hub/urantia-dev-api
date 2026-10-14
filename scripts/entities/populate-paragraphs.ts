/**
 * Populate the paragraphs table with entity JSONB data.
 * Reads data/entities/paragraph-entities.json and updates the DB.
 *
 * Uses batched SQL updates (UPDATE ... FROM VALUES) for performance.
 * Resumable: skips paragraphs that already have entities populated.
 *
 * For section-only refs (e.g., "148:7"), resolves to all paragraphs
 * in that section by querying the DB.
 *
 * Usage: DATABASE_URL=... bun scripts/entities/populate-paragraphs.ts
 *        DATABASE_URL=... bun scripts/entities/populate-paragraphs.ts --force  (overwrite existing)
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { like, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { paragraphs } from "../../src/db/schema.ts";
import type { ParagraphEntity } from "./config.ts";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error("DATABASE_URL environment variable is required");
	process.exit(1);
}

const force = process.argv.includes("--force");

const dataPath = join(import.meta.dir, "../../data/entities/paragraph-entities.json");
const paragraphMap: Record<string, ParagraphEntity[]> = JSON.parse(readFileSync(dataPath, "utf-8"));

const client = postgres(DATABASE_URL);
const db = drizzle(client);

const BATCH_SIZE = 500;

/**
 * Batch update paragraphs using a single SQL statement per batch.
 * Uses UPDATE ... FROM (VALUES ...) pattern for efficient bulk updates.
 */
async function batchUpdateEntities(updates: [string, ParagraphEntity[]][]): Promise<number> {
	let totalUpdated = 0;

	for (let i = 0; i < updates.length; i += BATCH_SIZE) {
		const batch = updates.slice(i, i + BATCH_SIZE);

		// Build VALUES clause: (ref, entities_json)
		const valuesClauses = batch
			.map(([ref, entities]) => {
				const jsonStr = JSON.stringify(entities).replace(/'/g, "''");
				const escapedRef = ref.replace(/'/g, "''");
				return `('${escapedRef}', '${jsonStr}'::jsonb)`;
			})
			.join(",\n  ");

		const query = `
			UPDATE paragraphs AS p
			SET entities = v.entities
			FROM (VALUES
			  ${valuesClauses}
			) AS v(ref, entities)
			WHERE p.standard_reference_id = v.ref
			${force ? "" : "AND p.entities IS NULL"}
		`;

		const result = await client.unsafe(query);
		totalUpdated += result.count;

		process.stdout.write(
			`\r  Processed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} (${totalUpdated} rows updated)`,
		);
	}

	console.log();
	return totalUpdated;
}

async function populate() {
	const refs = Object.keys(paragraphMap);
	console.log(`Loaded ${refs.length} references from paragraph-entities.json`);
	if (!force) {
		console.log(
			`  (resumable mode — skipping already-populated paragraphs. Use --force to overwrite)`,
		);
	}

	// Separate paragraph-level refs from section-only refs
	const paragraphRefs: [string, ParagraphEntity[]][] = [];
	const sectionRefs: [string, ParagraphEntity[]][] = [];

	for (const ref of refs) {
		if (ref.includes(".")) {
			paragraphRefs.push([ref, paragraphMap[ref]]);
		} else {
			sectionRefs.push([ref, paragraphMap[ref]]);
		}
	}

	console.log(`  Paragraph-level refs: ${paragraphRefs.length}`);
	console.log(`  Section-only refs: ${sectionRefs.length}`);

	// 1. Batch update paragraph-level refs
	console.log("\nUpdating paragraph-level refs...");
	const paragraphUpdated = await batchUpdateEntities(paragraphRefs);

	// 2. Resolve section-only refs → expand to paragraph-level, then batch update
	console.log("\nResolving section-only refs...");
	const expandedUpdates: [string, ParagraphEntity[]][] = [];

	for (const [ref, entities] of sectionRefs) {
		// Find all paragraphs in this section
		const matchingParagraphs = await db
			.select({
				standardReferenceId: paragraphs.standardReferenceId,
				existingEntities: paragraphs.entities,
			})
			.from(paragraphs)
			.where(like(paragraphs.standardReferenceId, `${ref}.%`));

		for (const row of matchingParagraphs) {
			const existing: ParagraphEntity[] = (row.existingEntities as ParagraphEntity[]) || [];
			const merged = mergeEntities(existing, entities);
			expandedUpdates.push([row.standardReferenceId, merged]);
		}
	}

	console.log(
		`  Expanded ${sectionRefs.length} section refs into ${expandedUpdates.length} paragraph updates`,
	);

	let sectionUpdated = 0;
	if (expandedUpdates.length > 0) {
		console.log("  Batch updating expanded refs...");
		// For section expansions, always overwrite since we're merging
		const savedForce = force;
		sectionUpdated = await batchUpdateEntitiesForce(expandedUpdates);
	}

	// Coverage stats
	const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(paragraphs);

	const [{ covered }] = await db
		.select({ covered: sql<number>`count(*)` })
		.from(paragraphs)
		.where(sql`entities IS NOT NULL`);

	console.log(`\n--- Results ---`);
	console.log(`  Paragraph-level updates: ${paragraphUpdated}`);
	console.log(`  Section-expanded updates: ${sectionUpdated}`);
	console.log(`  Total paragraphs in DB: ${Number(total)}`);
	console.log(
		`  Paragraphs with entities: ${Number(covered)} (${((Number(covered) / Number(total)) * 100).toFixed(1)}%)`,
	);

	await client.end();
}

/**
 * Batch update that always overwrites (used for section-expanded merges).
 */
async function batchUpdateEntitiesForce(updates: [string, ParagraphEntity[]][]): Promise<number> {
	let totalUpdated = 0;

	for (let i = 0; i < updates.length; i += BATCH_SIZE) {
		const batch = updates.slice(i, i + BATCH_SIZE);

		const valuesClauses = batch
			.map(([ref, entities]) => {
				const jsonStr = JSON.stringify(entities).replace(/'/g, "''");
				const escapedRef = ref.replace(/'/g, "''");
				return `('${escapedRef}', '${jsonStr}'::jsonb)`;
			})
			.join(",\n  ");

		const query = `
			UPDATE paragraphs AS p
			SET entities = v.entities
			FROM (VALUES
			  ${valuesClauses}
			) AS v(ref, entities)
			WHERE p.standard_reference_id = v.ref
		`;

		const result = await client.unsafe(query);
		totalUpdated += result.count;

		process.stdout.write(
			`\r  Processed ${Math.min(i + BATCH_SIZE, updates.length)}/${updates.length} (${totalUpdated} rows updated)`,
		);
	}

	console.log();
	return totalUpdated;
}

/** Merge two entity arrays, deduplicating by entity ID */
function mergeEntities(
	existing: ParagraphEntity[],
	incoming: ParagraphEntity[],
): ParagraphEntity[] {
	const byId = new Map<string, ParagraphEntity>();
	for (const e of existing) byId.set(e.id, e);
	for (const e of incoming) byId.set(e.id, e);

	return [...byId.values()].sort((a, b) => {
		if (a.type !== b.type) return a.type.localeCompare(b.type);
		return a.name.localeCompare(b.name);
	});
}

populate().catch((err) => {
	console.error("Populate failed:", err);
	process.exit(1);
});
