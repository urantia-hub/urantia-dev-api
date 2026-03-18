import type { MiddlewareHandler } from "hono";

/**
 * Sets Cache-Control headers based on route pattern.
 * Cloudflare's CDN respects s-maxage for edge caching.
 */
export function cacheControl(): MiddlewareHandler {
	return async (c, next) => {
		await next();

		// Don't cache error responses
		if (c.res.status >= 400) return;

		const path = c.req.path;

		if (path.startsWith("/og/")) {
			c.header("Cache-Control", "public, max-age=31536000, immutable");
		} else if (path === "/paragraphs/random" || path === "/health") {
			c.header("Cache-Control", "no-store");
		} else if (path === "/search") {
			c.header("Cache-Control", "public, s-maxage=3600, max-age=300");
		} else if (
			path === "/" ||
			path === "/docs" ||
			path === "/openapi.json"
		) {
			c.header("Cache-Control", "public, s-maxage=3600, max-age=300");
		} else {
			// Static content: /toc, /papers/*, /paragraphs/*, /audio/*
			c.header(
				"Cache-Control",
				"public, s-maxage=86400, max-age=3600, stale-while-revalidate=86400",
			);
		}
	};
}
