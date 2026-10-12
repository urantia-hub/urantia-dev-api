import type { MiddlewareHandler } from "hono";
import { problemJson } from "../lib/errors.ts";

interface RateLimitEntry {
	count: number;
	resetAt: number;
}

declare module "hono" {
	interface ContextVariableMap {
		// Set while a request over the limit waits for the check of its token: see `ownAppGate`.
		overLimit: boolean | undefined;
	}
}

const store = new Map<string, RateLimitEntry>();

// `scope` gives a route-level limiter its own counters, apart from the global limiter.
// `ownAppsMax`: a higher limit for one of our own apps. A request between `max` and this number that
// carries a token goes on to the check of the token, and `ownAppGate` (after the auth middleware) lets
// it through only for one of our own apps. The server of UrantiaHub calls for all its readers from a
// few addresses, so one limit for an address was one limit for all of them. The Hub has its own limit
// for each reader. Above `ownAppsMax` each request stops here, with no look at its token: so a flood
// of made-up tokens costs a bounded number of checks, and no caller has no limit at all.
export function rateLimiter(opts: {
	windowMs: number;
	max: number;
	scope?: string;
	ownAppsMax?: number;
}): MiddlewareHandler {
	const { windowMs, max, scope, ownAppsMax } = opts;

	return async (c, next) => {
		// Inline cleanup instead of setInterval (Workers-compatible)
		if (store.size > 10_000) {
			const now = Date.now();
			for (const [key, entry] of store) {
				if (now >= entry.resetAt) store.delete(key);
			}
		}

		const ip =
			c.req.header("cf-connecting-ip") ??
			c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
			"unknown";
		const key = scope ? `${scope}:${ip}` : ip;

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
			const held =
				ownAppsMax !== undefined &&
				entry.count <= ownAppsMax &&
				c.req.header("authorization")?.startsWith("Bearer ");
			if (!held) return problemJson(c, 429, "Too many requests, please try again later");
			c.set("overLimit", true);
		}

		await next();
	};
}

// After the auth middleware: a request over the limit goes on only with a token of one of our own apps.
export const ownAppGate: MiddlewareHandler = async (c, next) => {
	if (c.get("overLimit") && !c.get("tokenApp")?.firstParty) {
		return problemJson(c, 429, "Too many requests, please try again later");
	}
	await next();
};
