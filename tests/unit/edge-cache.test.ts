import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { edgeCache } from "../../src/middleware/edge-cache.ts";

// A stand-in for caches.default: one stored response for each URL.
function fakeCache() {
	const store = new Map<string, Response>();
	return {
		store,
		match: async (req: Request) => store.get(req.url)?.clone(),
		put: async (req: Request, res: Response) => {
			store.set(req.url, res);
		},
	};
}

function appWith(cache: ReturnType<typeof fakeCache>) {
	let calls = 0;
	const app = new Hono();
	app.use(
		"*",
		edgeCache(() => cache),
	);
	app.get("/papers/:id", (c) => {
		calls += 1;
		if (c.req.param("id") === "999") return c.json({ error: "not found" }, 404);
		return c.json({ id: c.req.param("id"), lang: c.req.query("lang") ?? "en" });
	});
	app.get("/paragraphs/random", (c) => {
		calls += 1;
		return c.json({ n: calls });
	});
	return { app, calls: () => calls };
}

const get = (app: Hono, path: string) => app.request(`https://api.urantia.dev${path}`);

describe("the edge cache", () => {
	// A burst of paper requests after a cold start reached the database each time (2026-10-25).
	it("answers a second request for the same paper from the cache", async () => {
		const cache = fakeCache();
		const { app, calls } = appWith(cache);
		const first = await get(app, "/papers/79?lang=es");
		const second = await get(app, "/papers/79?lang=es");
		expect(await second.json()).toEqual(await first.json());
		expect(calls()).toBe(1);
	});

	it("keeps each language and each paper apart", async () => {
		const { app, calls } = appWith(fakeCache());
		await get(app, "/papers/79?lang=es");
		const en = await get(app, "/papers/79");
		const other = await get(app, "/papers/80?lang=es");
		expect((await en.json()) as object).toEqual({ id: "79", lang: "en" });
		expect((await other.json()) as object).toEqual({ id: "80", lang: "es" });
		expect(calls()).toBe(3);
	});

	it("stores a copy for one hour at most, whatever the route says", async () => {
		const cache = fakeCache();
		const { app } = appWith(cache);
		await get(app, "/papers/1");
		const stored = cache.store.get("https://api.urantia.dev/papers/1");
		expect(stored?.headers.get("cache-control")).toBe("public, max-age=3600");
	});

	it("never stores an error", async () => {
		const cache = fakeCache();
		const { app, calls } = appWith(cache);
		await get(app, "/papers/999");
		await get(app, "/papers/999");
		expect(cache.store.size).toBe(0);
		expect(calls()).toBe(2);
	});

	it("leaves the other routes alone", async () => {
		const cache = fakeCache();
		const { app, calls } = appWith(cache);
		await get(app, "/paragraphs/random");
		await get(app, "/paragraphs/random");
		expect(cache.store.size).toBe(0);
		expect(calls()).toBe(2);
	});

	it("works with no cache, as in a local run", async () => {
		const app = new Hono();
		app.use(
			"*",
			edgeCache(() => undefined),
		);
		app.get("/papers/:id", (c) => c.json({ id: c.req.param("id") }));
		expect((await get(app, "/papers/3")).status).toBe(200);
	});
});
