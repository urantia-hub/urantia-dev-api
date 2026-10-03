import { describe, expect, it } from "bun:test";
import { app } from "../../src/index.ts";

const MCP_URL = "https://api.urantia.dev/mcp";

// biome-ignore lint/suspicious/noExplicitAny: the documents are read loosely
const json = async (path: string): Promise<any> => (await app.request(path)).json();

describe("MCP discovery under /.well-known", () => {
	for (const path of ["/.well-known/mcp.json", "/.well-known/mcp"]) {
		it(`${path} points at this API's MCP server`, async () => {
			const res = await app.request(path);
			expect(res.status).toBe(200);
			expect(res.headers.get("content-type")).toContain("application/json");

			const body = await json(path);
			expect(body.url).toBe(MCP_URL);
			expect(body.transport).toBe("streamable-http");
			expect(body.servers).toEqual([
				{
					name: "urantia-papers",
					url: MCP_URL,
					transport: "streamable-http",
					authentication: "none",
				},
			]);
		});
	}

	it("the server card describes the server and links to the docs and the spec", async () => {
		const card = await json("/.well-known/mcp/server-card.json");
		expect(card.name).toBe("Urantia Papers");
		expect(card.url).toBe(MCP_URL);
		expect(card.transport).toBe("streamable-http");
		expect(card.authentication).toBe("none");
		expect(card.capabilities).toEqual({ tools: true, resources: true, prompts: true });
		expect(card.documentation).toBe("https://urantia.dev/mcp-servers");
		expect(card.openapi).toBe("https://api.urantia.dev/openapi.json");
	});

	it("uses the version in server.json", async () => {
		const registry = JSON.parse(
			await Bun.file(new URL("../../server.json", import.meta.url)).text(),
		);
		expect((await json("/.well-known/mcp.json")).version).toBe(registry.version);
		expect((await json("/.well-known/mcp/server-card.json")).version).toBe(registry.version);
	});

	it("names no other product", async () => {
		const text = JSON.stringify([
			await json("/.well-known/mcp.json"),
			await json("/.well-known/mcp/server-card.json"),
		]).toLowerCase();
		expect(text).not.toContain("urantiahub");
		expect(text).not.toContain("mintlify");
	});

	it("still answers an OAuth discovery path with a 404", async () => {
		for (const path of [
			"/.well-known/oauth-authorization-server",
			"/.well-known/oauth-protected-resource/mcp",
			"/.well-known/openid-configuration",
		]) {
			expect((await app.request(path)).status).toBe(404);
		}
	});

	it("still serves the Glama verification file", async () => {
		expect((await app.request("/.well-known/glama.json")).status).toBe(200);
	});
});

describe("OpenAI plugin domain verification", () => {
	const path = "/.well-known/openai-apps-challenge";

	it("returns 404 when no token is set", async () => {
		expect((await app.request(path)).status).toBe(404);
	});

	it("returns only the token, as plain text", async () => {
		const res = await app.request(path, {}, { OPENAI_APPS_CHALLENGE: " token-abc123 \n" });
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/plain");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(await res.text()).toBe("token-abc123");
	});
});
