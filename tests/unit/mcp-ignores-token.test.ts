import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { authMiddleware } from "../../src/middleware/auth";

// The MCP server is open with no key. A client or a directory check that sends a token it does
// not need (Glama's test profile) must still get through, not 401.
function app() {
	const a = new Hono();
	a.use("*", authMiddleware);
	a.post("/mcp", (c) => c.text("open"));
	a.get("/me/bookmarks", (c) => c.text("mine"));
	return a;
}
const env = { SUPABASE_URL: "https://example.supabase.co" };
const junk = { authorization: "Bearer not-a-real-token" };

describe("a token on the open MCP server", () => {
	it("is ignored on /mcp", async () => {
		const res = await app().request("/mcp", { method: "POST", headers: junk }, env);
		expect(res.status).toBe(200);
	});

	it("still answers 401 on a path that needs a sign-in", async () => {
		const res = await app().request("/me/bookmarks", { headers: junk }, env);
		expect(res.status).toBe(401);
	});
});
