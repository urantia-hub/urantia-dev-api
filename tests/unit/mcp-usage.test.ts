import { describe, expect, it } from "bun:test";
import { MCP_TOOL_NAMES } from "../../src/lib/mcp-tool-names.ts";
import { USAGE_DAYS, usageFromRows } from "../../src/lib/mcp-usage.ts";

const now = new Date("2026-11-07T15:00:00Z");

describe("usageFromRows", () => {
	it("gives the full days before today, oldest first, with zero for a day with no row", () => {
		const usage = usageFromRows([], [], now);
		expect(usage.days).toHaveLength(USAGE_DAYS);
		expect(usage.days[0]?.day).toBe("2026-10-10");
		expect(usage.days.at(-1)?.day).toBe("2026-11-06");
		expect(usage.days.every((d) => d.chatgpt === 0 && d.other === 0)).toBe(true);
	});

	it("counts the family openai as ChatGPT and every other family as other", () => {
		const usage = usageFromRows(
			[
				{ day: "2026-11-06", family: "openai", calls: 7 },
				{ day: "2026-11-06", family: "sdk-fetch", calls: 3 },
				{ day: "2026-11-06", family: "claude", calls: 2 },
			],
			[{ name: "paragraphs.get", calls: 9 }],
			now,
		);
		expect(usage.days.at(-1)).toEqual({ day: "2026-11-06", chatgpt: 7, other: 5 });
		expect(usage.tools).toEqual([{ name: "paragraphs.get", calls: 9 }]);
	});

	it("leaves out today and any day outside the window", () => {
		const usage = usageFromRows(
			[
				{ day: "2026-11-07", family: "openai", calls: 50 },
				{ day: "2026-10-01", family: "openai", calls: 50 },
			],
			[],
			now,
		);
		expect(usage.days.reduce((n, d) => n + d.chatgpt + d.other, 0)).toBe(0);
	});
});

describe("MCP_TOOL_NAMES", () => {
	it("is the list of tools that the MCP server registers", async () => {
		const source = await Bun.file(`${import.meta.dir}/../../src/routes/mcp.ts`).text();
		const registered = [...source.matchAll(/registerTool\(\s*"([^"]+)"/g)]
			.map((m) => m[1] ?? "")
			.sort();
		expect(registered.length).toBeGreaterThan(20);
		expect([...MCP_TOOL_NAMES].sort()).toEqual(registered);
	});

	it("keeps a tool name that the server does not have out of the answer", () => {
		const usage = usageFromRows(
			[],
			[
				{ name: "visit-example-com", calls: 900 },
				{ name: "paragraphs.get", calls: 9 },
			],
			now,
		);
		expect(usage.tools).toEqual([{ name: "paragraphs.get", calls: 9 }]);
	});
});
