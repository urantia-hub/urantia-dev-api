import { describe, expect, it } from "bun:test";
import { app } from "../../src/index.ts";

// The docs live at docs.urantia.dev. urantia.dev itself is a landing page.
describe("links to the docs site", () => {
	it("redirects /mintlify-assets/* to docs.urantia.dev with the path and query", async () => {
		const res = await app.request("/mintlify-assets/_next/static/chunk.js?v=1");
		expect(res.status).toBe(301);
		expect(res.headers.get("location")).toBe(
			"https://docs.urantia.dev/mintlify-assets/_next/static/chunk.js?v=1",
		);
	});

	it("points the MCP discovery response at the setup guide", async () => {
		const res = await app.request("/mcp", { headers: { Accept: "application/json" } });
		const body = (await res.json()) as { server: { docs: string } };
		expect(body.server.docs).toBe("https://docs.urantia.dev/mcp-servers");
	});
});
