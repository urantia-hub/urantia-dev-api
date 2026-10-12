import type { MiddlewareHandler } from "hono";
import { problemJson } from "../lib/errors.ts";

interface RateLimitEntry {
	count: number;
	resetAt: number;
	// How many requests over the limit from this caller were not of one of our own apps.
	refusals?: number;
}

declare module "hono" {
	interface ContextVariableMap {
		// Set while a request over the limit waits for the check of its token: see `ownAppGate`.
		overLimit: RateLimitEntry | undefined;
		gateRefused: boolean | undefined;
	}
}

const store = new Map<string, RateLimitEntry>();

// A token of the Hub can be at its end, so some refusals are normal. After this many in one window,
// an address gets no more looks at a token.
const LOOKS = 20;
const refuse = (entry: RateLimitEntry) => {
	entry.refusals = (entry.refusals ?? 0) + 1;
};

// `scope` gives a route-level limiter its own counters, apart from the global limiter.
// `ownAppsPass`: a request over the limit that carries a token goes on to the check of the token, and
// `ownAppGate` (after the auth middleware) lets it through only for one of our own apps. The server of
// UrantiaHub calls for all its readers from a few addresses, so one limit for an address would be one
// limit for all of them. The Hub has its own limit for each reader.
export function rateLimiter(opts: {
	windowMs: number;
	max: number;
	scope?: string;
	ownAppsPass?: boolean;
}): MiddlewareHandler {
	const { windowMs, max, scope, ownAppsPass } = opts;

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
				ownAppsPass &&
				(entry.refusals ?? 0) < LOOKS &&
				c.req.header("authorization")?.startsWith("Bearer ");
			if (!held) return problemJson(c, 429, "Too many requests, please try again later");
			c.set("overLimit", entry);
			await next();
			// A token that was not good ends before the gate, so it is counted here.
			if (!c.get("tokenApp")?.firstParty && !c.get("gateRefused")) refuse(entry);
			return;
		}

		await next();
	};
}

// After the auth middleware: a request over the limit goes on only with a token of one of our own apps.
export const ownAppGate: MiddlewareHandler = async (c, next) => {
	const entry = c.get("overLimit");
	if (entry && !c.get("tokenApp")?.firstParty) {
		refuse(entry);
		c.set("gateRefused", true);
		return problemJson(c, 429, "Too many requests, please try again later");
	}
	await next();
};
