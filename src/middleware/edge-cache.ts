import type { MiddlewareHandler } from "hono";

type EdgeCache = {
	match(request: Request): Promise<Response | undefined>;
	put(request: Request, response: Response): Promise<void>;
};

// A Worker's own answer is not stored by Cloudflare, whatever its Cache-Control says, so each
// request reached the database. On 2026-10-25 a burst of about 90 paper requests took 5 to 12 s
// and 7 failed. This keeps the text of the Papers in the cache of each Cloudflare location.
const CACHED = /^\/(papers(\/|$)|toc$)/;
// A data update reaches readers within an hour.
const STORED_FOR = "public, max-age=3600";

const defaultCache = (): EdgeCache | undefined =>
	(globalThis as { caches?: { default?: EdgeCache } }).caches?.default;

export function edgeCache(getCache: () => EdgeCache | undefined = defaultCache): MiddlewareHandler {
	return async (c, next) => {
		const cache = c.req.method === "GET" && CACHED.test(c.req.path) ? getCache() : undefined;
		if (!cache) return next();

		// The key is the address alone: the answer of these routes does not depend on the caller.
		const key = new Request(c.req.url);
		const hit = await cache.match(key);
		if (hit) {
			// A copy, so that the middleware outside can still add its headers.
			c.res = new Response(hit.body, hit);
			return;
		}

		await next();
		if (c.res.status !== 200) return;
		const copy = new Response(c.res.clone().body, c.res);
		copy.headers.set("Cache-Control", STORED_FOR);
		const stored = cache.put(key, copy);
		try {
			c.executionCtx.waitUntil(stored);
		} catch {
			// No execution context in a local run or a test: wait here.
			await stored;
		}
	};
}
