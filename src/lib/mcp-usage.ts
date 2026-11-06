import { and, desc, gte, lt, sql } from "drizzle-orm";
import type { getDb } from "../db/client.ts";
import { mcpDailyCalls } from "../db/schema.ts";
import { MCP_TOOL_NAMES } from "./mcp-tool-names.ts";

type Db = ReturnType<typeof getDb>["db"];

/** Days of history that GET /stats/mcp-usage gives, the newest full day last. */
export const USAGE_DAYS = 28;
/** Days that the list of tools counts. */
export const TOOL_DAYS = 14;

export type UsageDay = { day: string; chatgpt: number; other: number };
export type McpUsage = {
	updatedAt: string;
	days: UsageDay[];
	tools: { name: string; calls: number }[];
};

const dayOf = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
	dayOf(new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000));

/** Adds one call for each known tool of one request. */
/** Families that are left out. Nearly all `sdk-fetch` tool calls are one outside checker that calls every tool on a schedule. */
export const SKIPPED_FAMILIES: ReadonlySet<string> = new Set(["sdk-fetch"]);

export async function recordMcpCalls(db: Db, family: string, tools: string[], now = new Date()) {
	const day = dayOf(now);
	// Only the server's own tools, each at most once a request: a caller can send any name and any batch.
	if (SKIPPED_FAMILIES.has(family)) return;
	const known = new Set(tools.filter((tool) => MCP_TOOL_NAMES.has(tool)));
	const rows = [...known].map((tool) => ({ day, family, tool, calls: 1 }));
	if (!rows.length) return;
	await db
		.insert(mcpDailyCalls)
		.values(rows)
		.onConflictDoUpdate({
			target: [mcpDailyCalls.day, mcpDailyCalls.family, mcpDailyCalls.tool],
			set: { calls: sql`${mcpDailyCalls.calls} + excluded.calls` },
		});
}

/** The full days before today, oldest first, with no gap: a day with no row counts zero. ChatGPT is the family "openai". */
export function usageFromRows(
	byDay: { day: string; family: string; calls: number }[],
	byTool: { name: string; calls: number }[],
	now = new Date(),
): McpUsage {
	const today = dayOf(now);
	const days: UsageDay[] = [];
	for (let i = USAGE_DAYS; i >= 1; i--)
		days.push({ day: addDays(today, -i), chatgpt: 0, other: 0 });
	const index = new Map(days.map((d) => [d.day, d]));
	for (const row of byDay) {
		const entry = index.get(row.day);
		if (!entry) continue;
		if (row.family === "openai") entry.chatgpt += row.calls;
		else entry.other += row.calls;
	}
	const tools = byTool.filter((t) => MCP_TOOL_NAMES.has(t.name));
	return { updatedAt: now.toISOString(), days, tools };
}

export async function readMcpUsage(db: Db, now = new Date()): Promise<McpUsage> {
	const today = dayOf(now);
	const from = addDays(today, -USAGE_DAYS);
	const toolsFrom = addDays(today, -TOOL_DAYS);
	const byDay = await db
		.select({
			day: mcpDailyCalls.day,
			family: mcpDailyCalls.family,
			calls: sql<number>`sum(${mcpDailyCalls.calls})::int`,
		})
		.from(mcpDailyCalls)
		.where(and(gte(mcpDailyCalls.day, from), lt(mcpDailyCalls.day, today)))
		.groupBy(mcpDailyCalls.day, mcpDailyCalls.family);
	const total = sql<number>`sum(${mcpDailyCalls.calls})::int`;
	const byTool = await db
		.select({ name: mcpDailyCalls.tool, calls: total })
		.from(mcpDailyCalls)
		.where(and(gte(mcpDailyCalls.day, toolsFrom), lt(mcpDailyCalls.day, today)))
		.groupBy(mcpDailyCalls.tool)
		.orderBy(desc(total))
		.limit(10);
	return usageFromRows(byDay, byTool, now);
}
