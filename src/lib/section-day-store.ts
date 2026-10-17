import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { sectionDays } from "../db/schema.ts";
import { MAX_LISTED, type SectionDayStore, type SectionRow } from "./section-days.ts";

type Db = ReturnType<typeof getDb>["db"];

export function createSectionDayStore(db: Db): SectionDayStore {
	return {
		async add(userId, rows) {
			// `xmax = 0` is true for a row that this statement inserted, false for one it updated.
			const done = await db
				.insert(sectionDays)
				.values(rows.map((row) => ({ userId, ...row })))
				.onConflictDoUpdate({
					target: [sectionDays.userId, sectionDays.day, sectionDays.paperId, sectionDays.sectionId],
					set: {
						how: sql`case when excluded.how = 'heard' then 'heard' else ${sectionDays.how} end`,
					},
				})
				.returning({ inserted: sql<boolean>`(xmax = 0)` });
			return done.filter((row) => row.inserted).length;
		},
		async list(userId, since) {
			const rows = await db
				.select({
					day: sectionDays.day,
					paperId: sectionDays.paperId,
					sectionId: sectionDays.sectionId,
					how: sectionDays.how,
				})
				.from(sectionDays)
				.where(
					since === null
						? eq(sectionDays.userId, userId)
						: and(eq(sectionDays.userId, userId), gte(sectionDays.day, since)),
				)
				.orderBy(desc(sectionDays.day))
				.limit(MAX_LISTED);
			// The newest rows are the ones kept, in the order of the days.
			return (rows as SectionRow[]).reverse();
		},
	};
}
