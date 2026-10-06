import { describe, expect, it } from "bun:test";
import { hashIp } from "../../src/lib/feedback-delivery.ts";
import { callerFields, readMcpSummary, summarizeMcp, weekOf } from "../../src/lib/request-log.ts";

describe("summarizeMcp", () => {
	it("names the client on initialize", () => {
		expect(
			summarizeMcp({
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: { clientInfo: { name: "claude-ai", version: "0.1.0" } },
			}),
		).toEqual({
			mcp_method: "initialize",
			mcp_tool: undefined,
			mcp_client: "claude-ai",
			mcp_client_version: "0.1.0",
		});
	});

	it("names the tool on tools/call, and joins a batch", () => {
		const summary = summarizeMcp([
			{ method: "tools/call", params: { name: "paragraphs.get" } },
			{ method: "tools/call", params: { name: "search.semantic" } },
		]);
		expect(summary.mcp_method).toBe("tools/call,tools/call");
		expect(summary.mcp_tool).toBe("paragraphs.get,search.semantic");
	});

	it("returns nothing for a body that is not JSON-RPC", () => {
		expect(summarizeMcp("text")).toEqual({
			mcp_method: undefined,
			mcp_tool: undefined,
			mcp_client: undefined,
			mcp_client_version: undefined,
		});
	});
});

describe("readMcpSummary", () => {
	it("reads a copy, so the original body is still readable", async () => {
		const body = JSON.stringify({ method: "tools/list" });
		const request = new Request("https://api.urantia.dev/mcp", {
			method: "POST",
			headers: { "content-length": String(body.length) },
			body,
		});
		expect((await readMcpSummary(request)).mcp_method).toBe("tools/list");
		expect(JSON.parse(await request.text())).toEqual({ method: "tools/list" });
	});

	it("ignores a body that is not JSON", async () => {
		const request = new Request("https://api.urantia.dev/mcp", {
			method: "POST",
			headers: { "content-length": "1" },
			body: "{",
		});
		expect(await readMcpSummary(request)).toEqual({});
	});

	it("does not read a body with no stated length or a large one", async () => {
		const body = JSON.stringify({ method: "tools/list" });
		// A body longer than the cap is not read, even when the length header says it is small.
		const lying = new Request("https://api.urantia.dev/mcp", {
			method: "POST",
			headers: { "content-length": "10" },
			body: JSON.stringify({ method: "x", pad: "a".repeat(70_000) }),
		});
		expect(await readMcpSummary(lying)).toEqual({});
		const large = new Request("https://api.urantia.dev/mcp", {
			method: "POST",
			headers: { "content-length": "100000" },
			body,
		});
		expect(await readMcpSummary(large)).toEqual({});
	});
});

describe("callerFields", () => {
	const headers = new Headers({
		"cf-connecting-ip": "203.0.113.7",
		"cf-ipcountry": "US",
		"user-agent": "Googlebot/2.1",
	});

	it("logs a keyed hash of the IP, never the IP itself", async () => {
		const fields = await callerFields(headers, "pepper");
		expect(fields.ip_hash).toHaveLength(16);
		expect(JSON.stringify(fields)).not.toContain("203.0.113.7");
		expect((await callerFields(headers, "pepper")).ip_hash).toBe(fields.ip_hash);
		expect((await callerFields(headers, "other")).ip_hash).not.toBe(fields.ip_hash);
	});

	it("never matches the feedback hash of the same IP", async () => {
		const fields = await callerFields(headers, "pepper");
		expect((await hashIp("203.0.113.7", "pepper")).startsWith(fields.ip_hash ?? "")).toBe(false);
	});

	it("is stable within a week and changes the next week", async () => {
		const monday = new Date("2026-10-05T01:00:00Z");
		const sunday = new Date("2026-10-11T23:00:00Z");
		const next = new Date("2026-10-12T01:00:00Z");
		expect(weekOf(sunday)).toBe("2026-10-05");
		const a = (await callerFields(headers, "pepper", monday)).ip_hash;
		expect((await callerFields(headers, "pepper", sunday)).ip_hash).toBe(a);
		expect((await callerFields(headers, "pepper", next)).ip_hash).not.toBe(a);
	});

	it("leaves the hash out when there is no pepper", async () => {
		expect((await callerFields(headers, undefined)).ip_hash).toBeUndefined();
	});

	it("records the country and marks a crawler as a bot", async () => {
		const fields = await callerFields(headers, "pepper");
		expect(fields.country).toBe("US");
		expect(fields.ua_family).toBe("bot-crawler");
		expect(fields.is_bot).toBe(true);
	});
});
