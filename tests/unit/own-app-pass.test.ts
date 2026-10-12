import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { ownAppGate, rateLimiter } from "../../src/middleware/rate-limit.ts";

// A small app with the real limiter and gate, and a stand-in for the auth middleware: the token
// "hub" is a token of one of our own apps, "other" is a token of another app, and each other token
// is refused, as the real middleware refuses a token that it cannot read.
function build(max = 2) {
	const app = new Hono();
	let handled = 0;
	let checked = 0;
	app.use("*", rateLimiter({ windowMs: 60_000, max, ownAppsPass: true }));
	app.use("*", async (c, next) => {
		c.set("tokenApp", null);
		const token = c.req.header("authorization")?.slice(7);
		if (!token) return next();
		checked += 1;
		if (token === "hub") c.set("tokenApp", { id: "urantiahub-app", firstParty: true });
		else if (token === "other") c.set("tokenApp", { id: "other-app", firstParty: false });
		else return c.json({ detail: "Invalid or expired token." }, 401);
		return next();
	});
	app.use("*", ownAppGate);
	app.get("/me", (c) => {
		handled += 1;
		return c.json({ ok: true });
	});
	const ask = async (ip: string, token?: string) =>
		app.request("/me", {
			headers: { "cf-connecting-ip": ip, ...(token ? { authorization: `Bearer ${token}` } : {}) },
		});
	return { ask, handled: () => handled, checked: () => checked };
}
const statuses = async (asks: Promise<Response>[]) =>
	(await Promise.all(asks)).map((r) => r.status);

describe("the limit for an address, and the pass of our own apps", () => {
	it("lets the server of our own app go on past the limit", async () => {
		const { ask, handled } = build();
		const ip = "10.1.0.1";
		expect(
			await statuses([
				ask(ip, "hub"),
				ask(ip, "hub"),
				ask(ip, "hub"),
				ask(ip, "hub"),
				ask(ip, "hub"),
			]),
		).toEqual([200, 200, 200, 200, 200]);
		expect(handled()).toBe(5);
	});

	it("stops a caller with no token at the limit, as before", async () => {
		const { ask, handled } = build();
		const ip = "10.1.0.2";
		for (const want of [200, 200, 429, 429]) expect((await ask(ip)).status).toBe(want);
		expect(handled()).toBe(2);
	});

	it("stops another app at the limit, and its route does not run", async () => {
		const { ask, handled } = build();
		const ip = "10.1.0.3";
		for (const want of [200, 200, 429, 429]) expect((await ask(ip, "other")).status).toBe(want);
		expect(handled()).toBe(2);
	});

	it("looks at twenty bad tokens past the limit, and then at no more from that address", async () => {
		const { ask, checked } = build();
		const ip = "10.1.0.4";
		for (let i = 0; i < 2 + 20; i += 1) expect((await ask(ip, "made-up")).status).toBe(401);
		for (let i = 0; i < 5; i += 1) expect((await ask(ip, "made-up")).status).toBe(429);
		expect(checked()).toBe(22);
	});

	it("still lets our own app through after a token of it was at its end", async () => {
		const { ask } = build();
		const ip = "10.1.0.5";
		for (const want of [200, 200, 200]) expect((await ask(ip, "hub")).status).toBe(want);
		expect((await ask(ip, "made-up")).status).toBe(401);
		expect((await ask(ip, "hub")).status).toBe(200);
	});

	it("counts each refusal of another app one time", async () => {
		const { ask, checked } = build();
		const ip = "10.1.0.8";
		for (let i = 0; i < 2; i += 1) expect((await ask(ip, "other")).status).toBe(200);
		for (let i = 0; i < 25; i += 1) expect((await ask(ip, "other")).status).toBe(429);
		expect(checked()).toBe(22);
	});

	it("keeps the count of each address apart", async () => {
		const { ask } = build();
		for (const want of [200, 200, 429]) expect((await ask("10.1.0.6")).status).toBe(want);
		expect((await ask("10.1.0.7")).status).toBe(200);
	});
});
