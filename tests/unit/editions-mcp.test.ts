import { describe, expect, it } from "bun:test";
import { app } from "../../src/index.ts";

// The editions tools read the JSON only, so these calls need no database.
const HEADERS = {
	"content-type": "application/json",
	accept: "application/json, text/event-stream",
	"cf-connecting-ip": "editions-mcp-test",
};

async function rpc(method: string, params: Record<string, unknown> = {}) {
	const res = await app.request("/mcp", {
		method: "POST",
		headers: HEADERS,
		body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
	});
	const text = await res.text();
	const line = text.split("\n").find((l) => l.startsWith("data: "));
	return JSON.parse(line ? line.slice(6) : text).result;
}

const call = async (name: string, args: Record<string, unknown> = {}) =>
	rpc("tools/call", { name, arguments: args });

describe("MCP initialize", () => {
	it("gives instructions that name the editions tools, and a description", async () => {
		const r = await rpc("initialize", {
			protocolVersion: "2025-06-18",
			capabilities: {},
			clientInfo: { name: "test", version: "1" },
		});
		expect(r.instructions).toContain("editions.list");
		expect(r.instructions).toContain("editions.variants");
		expect(r.instructions).toContain("quotes.verify");
		expect(r.serverInfo.description.length).toBeGreaterThan(20);
	});
});

describe("MCP editions tools", () => {
	it("editions.list gives the 6 editions, the original first", async () => {
		const r = await call("editions.list");
		const ids = r.structuredContent.data.map((e: { id: string }) => e.id);
		expect(ids).toEqual(["1955", "srt-2009", "srt-2015", "srt-2018", "srt-2021", "srt-2024"]);
		expect(r.structuredContent.meta.default).toBe("srt-2024");
	});

	it("editions.variants filters by paper and by edition", async () => {
		const p61 = await call("editions.variants", { paper: "61" });
		for (const v of p61.structuredContent.data) expect(v.ref.startsWith("61:")).toBe(true);
		const e2021 = await call("editions.variants", { edition: "srt-2021" });
		expect(e2021.structuredContent.meta.total).toBeGreaterThan(0);
		for (const v of e2021.structuredContent.data) expect(v.year).toBe(2021);
	});

	it("editions.variants compares 1955 with a later edition in one call", async () => {
		const r = await call("editions.variants", { from: "1955", to: "srt-2015" });
		const { data, meta } = r.structuredContent;
		expect(meta.total).toBe(data.length);
		expect(meta.applied).toBeLessThan(meta.total);
		for (const v of data) expect(v.year ?? 2009).toBeLessThanOrEqual(2015);
	});

	it("editions.variants gives an error for an unknown edition", async () => {
		const r = await call("editions.variants", { edition: "1956" });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain("Unknown edition");
	});
});
