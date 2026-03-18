import type { MiddlewareHandler } from "hono";
import { problemJson } from "../lib/errors.ts";

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

export function rateLimiter(opts: {
	windowMs: number;
	max: number;
}): MiddlewareHandler {
	const { windowMs, max } = opts;

	return async (c, next) => {
		// Inline cleanup instead of setInterval (Workers-compatible)
		if (store.size > 10_000) {
			const now = Date.now();
			for (const [key, entry] of store) {
				if (now >= entry.resetAt) store.delete(key);
			}
		}

		const key =
			c.req.header("cf-connecting-ip") ??
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";

		const now = Date.now();
		let entry = store.get(key);

		if (!entry || now >= entry.resetAt) {
			entry = { count: 0, resetAt: now + windowMs };
			store.set(key, entry);
		}

		entry.count++;

		c.header("X-RateLimit-Limit", String(max));
		c.header("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
		c.header("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));

		if (entry.count > max) {
			return problemJson(c, 429, "Too many requests, please try again later");
		}

		await next();
	};
}
