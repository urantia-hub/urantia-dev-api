import type { Context } from "hono";
import { getDb } from "../db/client.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { createSectionDayStore } from "../lib/section-day-store.ts";
import { isDay, parseSectionRows, type SectionDayStore } from "../lib/section-days.ts";

// The streak of UrantiaHub: the sections that the reader finished on each reading day.
// None of these routes is in the public spec.

type Deps = { store(c: Context): SectionDayStore };

const live: Deps = { store: (c) => createSectionDayStore(getDb(c.env?.HYPERDRIVE).db) };

async function body(c: Context): Promise<unknown> {
	try {
		return await c.req.json();
	} catch {
		return null;
	}
}

export function createStreakRoute(deps: Deps = live) {
	const route = createApp();
	const reader = (c: Context): string | null =>
		(c.get("user") as { id: string } | null)?.id ?? null;
	const NO_READER = "Authentication required. Provide a valid Bearer token.";

	route.get("/me/section-days", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const since = c.req.query("since") ?? null;
		if (since !== null && !isDay(since))
			return problemJson(c, 400, "`since` is a day as YYYY-MM-DD.");
		return c.json({ data: await deps.store(c).list(userId, since) }, 200);
	});

	route.post("/me/section-days", async (c) => {
		const userId = reader(c);
		if (!userId) return problemJson(c, 401, NO_READER);
		const rows = parseSectionRows(await body(c));
		if (!rows) return problemJson(c, 400, "The rows are not valid.");
		return c.json({ data: { added: await deps.store(c).add(userId, rows) } }, 200);
	});

	return route;
}

export const streakRoute = createStreakRoute();
