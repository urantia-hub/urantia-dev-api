// The sections that a reader finished on each reading day, for the streak of UrantiaHub.
// The API only stores them. The Hub decides when a section is finished and which day it is.

export type SectionRow = { day: string; paperId: string; sectionId: string; how: "read" | "heard" };

export const MAX_ROWS = 50;
export const MAX_LISTED = 5000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

// A real date as YYYY-MM-DD. "2026-02-30" is refused.
export function isDay(value: unknown): value is string {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseRow(value: unknown): SectionRow | null {
	if (!isRecord(value)) return null;
	const { day, paperId, sectionId, how } = value;
	if (!isDay(day)) return null;
	if (typeof paperId !== "string" || !/^(0|[1-9]\d{0,2})$/.test(paperId) || Number(paperId) > 196)
		return null;
	if (typeof sectionId !== "string" || !/^\d{1,3}$/.test(sectionId)) return null;
	if (how !== "read" && how !== "heard") return null;
	return { day, paperId, sectionId, how };
}

// A list from the Hub. One row that is not valid refuses the whole list.
export function parseSectionRows(value: unknown): SectionRow[] | null {
	const list = isRecord(value) ? value.rows : null;
	if (!Array.isArray(list) || list.length === 0 || list.length > MAX_ROWS) return null;
	const rows = list.map(parseRow);
	if (!rows.every((row): row is SectionRow => row !== null)) return null;
	// One row for a section on a day: a statement cannot change the same row two times.
	const byKey = new Map<string, SectionRow>();
	for (const row of rows) {
		const key = `${row.day}|${row.paperId}|${row.sectionId}`;
		const had = byKey.get(key);
		if (!had || row.how === "heard") byKey.set(key, row);
	}
	return [...byKey.values()];
}

export interface SectionDayStore {
	// Inserts the rows that are new, and answers how many. A heard row makes a read row heard.
	add(userId: string, rows: SectionRow[]): Promise<number>;
	list(userId: string, since: string | null): Promise<SectionRow[]>;
}
