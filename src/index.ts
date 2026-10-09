import { swaggerUI } from "@hono/swagger-ui";
import { sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { getDb } from "./db/client.ts";
import { API_CATALOG_TYPE, apiCatalog } from "./lib/api-catalog.ts";
import { createApp } from "./lib/app.ts";
import { ICON_SVG, iconPng } from "./lib/brand-icon.ts";
import { problemJson } from "./lib/errors.ts";
import { mcpManifest, mcpServerCard } from "./lib/mcp-discovery.ts";
import { finalizeOpenApi } from "./lib/openapi-finalize.ts";
import { authMiddleware } from "./middleware/auth.ts";
import { cacheControl } from "./middleware/cache.ts";
import { corsMiddleware } from "./middleware/cors.ts";
import { loggerMiddleware } from "./middleware/logger.ts";
import { rateLimiter } from "./middleware/rate-limit.ts";
import { scannerBlock } from "./middleware/security.ts";
import { adminRoute } from "./routes/admin.ts";
import { alertWebhookRoute } from "./routes/alert-webhook.ts";
import { sendEmailHookRoute } from "./routes/send-email-hook.ts";
import { audioRoute } from "./routes/audio.ts";
import { authRoute } from "./routes/auth.ts";
import { bibleRoute } from "./routes/bible.ts";
import { citeRoute } from "./routes/cite.ts";
import { embeddingsRoute } from "./routes/embeddings.ts";
import { entitiesRoute } from "./routes/entities.ts";
import { feedbackRoute } from "./routes/feedback.ts";
import { languagesRoute } from "./routes/languages.ts";
import { mcpRoute } from "./routes/mcp.ts";
import { meRoute } from "./routes/me.ts";
import { ogRoute } from "./routes/og.ts";
import { papersRoute } from "./routes/papers.ts";
import { paragraphsRoute } from "./routes/paragraphs.ts";
import { quotesRoute } from "./routes/quotes.ts";
import { scriptureInsightsRoute } from "./routes/scripture-insights.ts";
import { scripturesRoute } from "./routes/scriptures.ts";
import { searchRoute } from "./routes/search.ts";
import { tocRoute } from "./routes/toc.ts";
import { toolsRoute } from "./routes/tools.ts";
import type { Env } from "./types/env.ts";

const app = createApp<Env>();

// Global error handler
app.onError((err, c) => {
	// Let HTTPException propagate with its own response (used by @hono/mcp)
	if (err instanceof HTTPException) {
		return err.getResponse();
	}

	const logger = c.get("logger");

	if (logger) {
		logger.error(err.message, {
			method: c.req.method,
			path: c.req.path,
			stack: err.stack,
			cf_ray: c.req.header("cf-ray") ?? undefined,
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

// Favicon and MCP server icon: the urantia.dev mark. Clients show it next to the connector.
const ICON_CACHE = "public, max-age=86400";
app.get("/favicon.svg", (c) =>
	c.body(ICON_SVG, 200, { "Content-Type": "image/svg+xml", "Cache-Control": ICON_CACHE }),
);
app.get("/icon.png", (c) =>
	c.body(iconPng(), 200, { "Content-Type": "image/png", "Cache-Control": ICON_CACHE }),
);
// A PNG body is valid at /favicon.ico for every current browser and favicon fetcher.
app.get("/favicon.ico", (c) =>
	c.body(iconPng(), 200, { "Content-Type": "image/png", "Cache-Control": ICON_CACHE }),
);

// robots.txt
app.get("/robots.txt", (c) => {
	const robotsTxt = `User-agent: *
Content-Signal: ai-train=yes, search=yes, ai-input=yes
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

// Glama maintainer verification (https://glama.ai/mcp/connectors/dev.urantia/urantia-papers)
app.get("/.well-known/glama.json", (c) =>
	c.json({
		$schema: "https://glama.ai/mcp/schemas/connector.json",
		maintainers: [{ email: "kgadams93@gmail.com" }],
	}),
);

// OpenAI plugin domain verification. The portal fetches this path and expects its token
// as plain text, with nothing else in the body. No token set: 404.
app.get("/.well-known/openai-apps-challenge", (c) => {
	const token = (c.env?.OPENAI_APPS_CHALLENGE ?? process.env.OPENAI_APPS_CHALLENGE)?.trim();
	if (!token) return c.notFound();
	return c.text(token, 200, { "Cache-Control": "no-store" });
});

// MCP discovery: where this API's MCP server is, and what it offers.
// These sit before the catch-all below, which answers every other well-known path with a 404.
app.get("/.well-known/mcp.json", (c) => c.json(mcpManifest()));
app.get("/.well-known/mcp", (c) => c.json(mcpManifest()));
app.get("/.well-known/mcp/server-card.json", (c) => c.json(mcpServerCard()));
app.get("/.well-known/api-catalog", (c) =>
	c.body(JSON.stringify(apiCatalog()), 200, { "Content-Type": API_CATALOG_TYPE }),
);

// OAuth/OIDC metadata discovery — return JSON 404 so MCP clients (Claude Code) know no auth is needed
// Covers all discovery paths: root, path-aware (RFC 8414), MCP-scoped, and protected resource (RFC 9728)
app.get("/.well-known/*", (c) => problemJson(c, 404, "This server requires no authentication."));

// Mintlify docs are hosted at docs.urantia.dev. Some clients (stale caches,
// bots constructing URLs from the OpenAPI spec, etc.) request /mintlify-assets/*
// against api.urantia.dev. Redirect them to where the assets actually live.
app.all("/mintlify-assets/*", (c) => {
	const path = new URL(c.req.url).pathname;
	const search = new URL(c.req.url).search;
	return c.redirect(`https://docs.urantia.dev${path}${search}`, 301);
});

// MCP server (mounted before OpenAPI doc generation so it doesn't pollute the REST spec)
app.route("/mcp", mcpRoute);

// Admin routes (excluded from public OpenAPI spec — internal only, ADMIN_USER_IDS gated)
app.route("/admin", adminRoute);

// Authenticated routes
app.route("/me", meRoute);
app.route("/auth", authRoute);

// Public routes
app.route("/toc", tocRoute);
app.route("/papers", papersRoute);
// /paragraphs with no reference has no data. Send people and crawlers to its docs page.
for (const path of ["/paragraphs", "/paragraphs/"]) {
	app.get(path, (c) => c.redirect("https://docs.urantia.dev/paragraphs", 301));
}
app.route("/paragraphs", paragraphsRoute);
app.route("/search", searchRoute);
app.route("/entities", entitiesRoute);
app.route("/languages", languagesRoute);
app.route("/audio", audioRoute);
app.route("/bible", bibleRoute);
// Before /scriptures, so "insights" is not read as a corpus name.
app.route("/scriptures/insights", scriptureInsightsRoute);
app.route("/scriptures", scripturesRoute);
app.route("/cite", citeRoute);
app.route("/quotes", quotesRoute);
app.route("/og", ogRoute);
app.route("/embeddings", embeddingsRoute);
app.route("/tools", toolsRoute);
app.route("/feedback", feedbackRoute);
app.route("/hooks/posthog-alerts", alertWebhookRoute);
app.route("/hooks/send-email", sendEmailHookRoute);

// OpenAPI spec
const OPENAPI_CONFIG = {
	openapi: "3.1.0",
	info: {
		title: "Urantia Papers API",
		version: "1.0.0",
		description:
			"An API and MCP server for the Urantia Papers. Structured access to all 197 papers and more than 14,500 paragraphs, with full-text and semantic search, named entities, cross-references to the Bible and to the texts of other world religions, and audio. No key needed. Docs: https://docs.urantia.dev",
		termsOfService: "https://docs.urantia.dev/terms-of-service",
		contact: {
			name: "urantia.dev",
			url: "https://docs.urantia.dev/help",
			email: "kelson@urantia.dev",
		},
		license: {
			name: "MIT",
			url: "https://github.com/urantia-hub/urantia-dev-api/blob/main/LICENSE",
		},
	},
	servers: [
		{ url: "https://api.urantia.dev", description: "Production" },
		{ url: "http://localhost:3000", description: "Local development" },
	],
};
app.get("/openapi.json", (c) => c.json(finalizeOpenApi(app.getOpenAPI31Document(OPENAPI_CONFIG))));

// Swagger UI
app.get("/docs", swaggerUI({ url: "/openapi.json" }));

const port = Number(process.env.PORT) || 3000;

// Durable Object class for the feedback limiter. Workers needs it exported from the main module.
export { FeedbackRateLimiter } from "./lib/feedback-limiter.ts";
export { app };

export default {
	port,
	fetch: app.fetch,
};

console.log(`Urantia Papers API running on http://localhost:${port}`);
console.log(`Docs: http://localhost:${port}/docs`);
console.log(`OpenAPI: http://localhost:${port}/openapi.json`);
