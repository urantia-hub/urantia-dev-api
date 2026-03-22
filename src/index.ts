import { swaggerUI } from "@hono/swagger-ui";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "./db/client.ts";
import { createApp } from "./lib/app.ts";
import { problemJson } from "./lib/errors.ts";
import type { Env } from "./types/env.ts";
import { cacheControl } from "./middleware/cache.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { rateLimiter } from "./middleware/rate-limit.ts";
import { scannerBlock } from "./middleware/security.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { authRoute } from "./routes/auth.ts";
import { meRoute } from "./routes/me.ts";
import { audioRoute } from "./routes/audio.ts";
import { citeRoute } from "./routes/cite.ts";
import { embeddingsRoute } from "./routes/embeddings.ts";
import { entitiesRoute } from "./routes/entities.ts";
import { languagesRoute } from "./routes/languages.ts";
import { mcpRoute } from "./routes/mcp.ts";
import { ogRoute } from "./routes/og.ts";
import { papersRoute } from "./routes/papers.ts";
import { paragraphsRoute } from "./routes/paragraphs.ts";
import { searchRoute } from "./routes/search.ts";
import { tocRoute } from "./routes/toc.ts";

const app = createApp<Env>();

// Global error handler
app.onError((err, c) => {
	// Let HTTPException propagate with its own response (used by @hono/mcp)
	if (err instanceof HTTPException) {
		return err.getResponse();
	}

	const logger = c.get("logger");
	const ip =
		c.req.header("cf-connecting-ip") ??
		c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
		"unknown";

	if (logger) {
		logger.error(err.message, {
			method: c.req.method,
			path: c.req.path,
			stack: err.stack,
			cf_ray: c.req.header("cf-ray") ?? undefined,
			ip,
		});
	} else {
		console.error(`[ERROR] ${c.req.method} ${c.req.path}:`, err.message);
	}

	return problemJson(c, 500, "Internal server error");
});

// Global middleware
app.use("*", scannerBlock);
app.use("*", corsMiddleware);
app.use("*", loggerMiddleware);
app.use("*", rateLimiter({ windowMs: 60_000, max: 200 }));
app.use("*", authMiddleware);
app.use("*", cacheControl());

// Health check
app.get("/", (c) =>
	c.json({
		name: "Urantia Papers API",
		version: "1.0.0",
		docs: "/docs",
		openapi: "/openapi.json",
	}),
);

// Health check with DB connectivity
app.get("/health", async (c) => {
	const timestamp = new Date().toISOString();
	try {
		const { db } = getDb(c.env?.HYPERDRIVE);
		await db.execute(sql`SELECT 1`);
		c.header("Cache-Control", "no-store");
		return c.json({ status: "healthy", db: "connected", timestamp });
	} catch (err) {
		c.header("Cache-Control", "no-store");
		return problemJson(c, 503, err instanceof Error ? err.message : "Database connection failed");
	}
});

// robots.txt
app.get("/robots.txt", (c) => {
	const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://api.urantia.dev/sitemap.xml
`;
	return c.text(robotsTxt, 200, { "Content-Type": "text/plain" });
});

// sitemap.xml
app.get("/sitemap.xml", (c) => {
	const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://api.urantia.dev</loc>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://api.urantia.dev/docs</loc>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://api.urantia.dev/openapi.json</loc>
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>
</urlset>`;
	return c.text(sitemap, 200, { "Content-Type": "application/xml" });
});

// OAuth/OIDC metadata discovery — return JSON 404 so MCP clients (Claude Code) know no auth is needed
// Covers all discovery paths: root, path-aware (RFC 8414), MCP-scoped, and protected resource (RFC 9728)
app.get("/.well-known/*", (c) =>
	problemJson(c, 404, "This server requires no authentication."),
);

// MCP server (mounted before OpenAPI doc generation so it doesn't pollute the REST spec)
app.route("/mcp", mcpRoute);

// Authenticated routes
app.route("/me", meRoute);
app.route("/auth", authRoute);

// Public routes
app.route("/toc", tocRoute);
app.route("/papers", papersRoute);
app.route("/paragraphs", paragraphsRoute);
app.route("/search", searchRoute);
app.route("/entities", entitiesRoute);
app.route("/languages", languagesRoute);
app.route("/audio", audioRoute);
app.route("/cite", citeRoute);
app.route("/og", ogRoute);
app.route("/embeddings", embeddingsRoute);

// OpenAPI spec
app.doc("/openapi.json", {
	openapi: "3.1.0",
	info: {
		title: "Urantia Papers API",
		version: "1.0.0",
		description:
			"A developer and AI-agent friendly API for the Urantia Papers. Provides full-text search, structured content access, and audio URLs for all 17,000+ paragraphs across 197 papers.",
	},
	servers: [
		{ url: "https://api.urantia.dev", description: "Production" },
		{ url: "http://localhost:3000", description: "Local development" },
	],
});

// Swagger UI
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

const port = Number(process.env.PORT) || 3000;

export { app };

export default {
	port,
	fetch: app.fetch,
};

console.log(`Urantia Papers API running on http://localhost:${port}`);
console.log(`Docs: http://localhost:${port}/docs`);
console.log(`OpenAPI: http://localhost:${port}/openapi.json`);
