import { eq, inArray } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { entities, paragraphEntities } from "../db/schema.ts";

type Db = ReturnType<typeof getDb>["db"];
type ParagraphRow = { id: string; [key: string]: unknown };
type EntityMention = { id: string; name: string; type: string };
export type TopEntity = EntityMention & { count: number };

/** Check if `include` query param contains "entities" */
export function wantsEntities(include: string | undefined): boolean {
	if (!include) return false;
	return include.split(",").map((s) => s.trim()).includes("entities");
}

/**
 * Check if `include` query param contains "topEntities".
 * Case-sensitive: only matches the exact literal "topEntities".
 */
export function wantsTopEntities(include: string | undefined): boolean {
	if (!include) return false;
	return include.split(",").map((s) => s.trim()).includes("topEntities");
}

/**
 * Batch-enrich paragraph rows with their entity mentions via the junction table.
 * Returns new array with `entities` array attached to each row.
 */
export async function enrichWithEntities<T extends ParagraphRow>(
	db: Db,
	rows: T[],
): Promise<(T & { entities: EntityMention[] })[]> {
	if (rows.length === 0) return [];

	const paragraphIds = rows.map((r) => r.id);

	// Fetch all junction + entity data in one query
	const junctionRows = await db
		.select({
			paragraphId: paragraphEntities.paragraphId,
			entityId: entities.id,
			entityName: entities.name,
			entityType: entities.type,
		})
		.from(paragraphEntities)
		.innerJoin(entities, eq(paragraphEntities.entityId, entities.id))
		.where(inArray(paragraphEntities.paragraphId, paragraphIds));

	// Group by paragraph ID
	const entityMap = new Map<string, EntityMention[]>();
	for (const row of junctionRows) {
		const list = entityMap.get(row.paragraphId) ?? [];
		list.push({ id: row.entityId, name: row.entityName, type: row.entityType });
		entityMap.set(row.paragraphId, list);
	}

	// Attach to each paragraph
	return rows.map((r) => ({
		...r,
		entities: entityMap.get(r.id) ?? [],
	}));
}

/**
 * Aggregate entity mentions across a set of paragraphs into a frequency-sorted
 * list. Entities are deduplicated by id and counted by the number of paragraphs
 * they appear in. Used for the paper-level `topEntities` field.
 *
 * `limit` caps the returned list (default 12). Types are tier-ranked so that
 * persons/places/concepts surface before orders/races/religions when the long
 * tail gets cut off — matches what reads best as YouTube tags and UI chips.
 */
export function aggregateTopEntities(
	paragraphs: readonly { entities?: EntityMention[] }[],
	limit = 12,
): TopEntity[] {
	const TYPE_TIER: Record<string, number> = {
		being: 0,
		place: 0,
		concept: 0,
		order: 1,
		race: 1,
		religion: 1,
	};

	const counts = new Map<string, TopEntity>();
	for (const p of paragraphs) {
		for (const e of p.entities ?? []) {
			const existing = counts.get(e.id);
			if (existing) {
				existing.count += 1;
			} else {
				counts.set(e.id, { id: e.id, name: e.name, type: e.type, count: 1 });
			}
		}
	}

	return [...counts.values()]
		.sort((a, b) => {
			const countDelta = b.count - a.count;
			if (countDelta !== 0) return countDelta;
			const tierDelta = (TYPE_TIER[a.type] ?? 2) - (TYPE_TIER[b.type] ?? 2);
			if (tierDelta !== 0) return tierDelta;
			return a.name.localeCompare(b.name);
		})
		.slice(0, limit);
}
