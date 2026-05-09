import { count, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client.ts";
import { apps, refreshTokens, users } from "../db/schema.ts";
import { type CfStatsRaw, type CfWindow, fetchCfStats } from "../lib/cf-analytics.ts";
import { problemJson } from "../lib/errors.ts";
import { classifyUserAgent, type UAFamily } from "../lib/ua-family.ts";
import type { Env } from "../types/env.ts";

export const adminRoute = new Hono<Env>();

function isAdmin(env: Env["Bindings"] | undefined, userId: string | undefined): boolean {
	if (!userId) return false;
	const adminIds = (env?.ADMIN_USER_IDS ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
	return adminIds.includes(userId);
}

function parseWindow(raw: string | undefined): CfWindow {
	return raw === "1h" || raw === "7d" ? raw : "24h";
}

function windowMs(w: CfWindow): number {
	return w === "1h" ? 60 * 60 * 1000 : w === "7d" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
}

function bucketStatus(byStatus: CfStatsRaw["byStatus"]): {
	"2xx": number;
	"3xx": number;
	"4xx": number;
	"5xx": number;
	other: number;
} {
	const out = { "2xx": 0, "3xx": 0, "4xx": 0, "5xx": 0, other: 0 };
	for (const r of byStatus) {
		if (r.status >= 200 && r.status < 300) out["2xx"] += r.requests;
		else if (r.status >= 300 && r.status < 400) out["3xx"] += r.requests;
		else if (r.status >= 400 && r.status < 500) out["4xx"] += r.requests;
		else if (r.status >= 500 && r.status < 600) out["5xx"] += r.requests;
		else out.other += r.requests;
	}
	return out;
}

function bucketUserAgents(
	rows: CfStatsRaw["topUserAgents"],
): Array<{ family: UAFamily; requests: number }> {
	const byFamily = new Map<UAFamily, number>();
	for (const r of rows) {
		const family = classifyUserAgent(r.userAgent);
		byFamily.set(family, (byFamily.get(family) ?? 0) + r.requests);
	}
	return [...byFamily.entries()]
		.map(([family, requests]) => ({ family, requests }))
		.sort((a, b) => b.requests - a.requests);
}

/**
 * Best-effort KV size sample. KV.list is paged at 1000 keys; we don't follow
 * the cursor — beyond that we just report `1000+`. Cheap, and the goal is a
 * gauge of cache warmth, not an exact count.
 */
async function sampleKvPrefix(
	kv: KVNamespace | undefined,
	prefix: string,
): Promise<{ count: number; truncated: boolean }> {
	if (!kv) return { count: 0, truncated: false };
	try {
		const res = await kv.list({ prefix, limit: 1000 });
		return { count: res.keys.length, truncated: !res.list_complete };
	} catch {
		return { count: 0, truncated: false };
	}
}

adminRoute.get("/stats", async (c) => {
	const user = c.get("user");
	if (!isAdmin(c.env, user?.id)) {
		// 404 (not 403) so the endpoint is invisible to non-admins.
		return problemJson(c, 404, "Not found.");
	}

	const window = parseWindow(c.req.query("window"));
	const since = new Date(Date.now() - windowMs(window));

	const apiToken = c.env?.CF_ANALYTICS_API_TOKEN ?? process.env.CF_ANALYTICS_API_TOKEN;
	const zoneTag = c.env?.CF_ZONE_TAG ?? process.env.CF_ZONE_TAG;

	const { db } = getDb(c.env?.HYPERDRIVE);

	// Run the four expensive lookups in parallel.
	const [cf, embCache, countCache, dbCounters] = await Promise.all([
		fetchCfStats(apiToken, zoneTag, window),
		sampleKvPrefix(c.env?.SEARCH_CACHE, "emb:"),
		sampleKvPrefix(c.env?.SEARCH_CACHE, "count:"),
		(async () => {
			const [appsTotalRow] = await db.select({ n: count() }).from(apps);
			const [usersTotalRow] = await db.select({ n: count() }).from(users);
			const [activeRow] = await db
				.select({ n: count() })
				.from(users)
				.where(gte(users.updatedAt, since));
			const [refreshRow] = await db
				.select({ n: count() })
				.from(refreshTokens)
				.where(gte(refreshTokens.createdAt, since));
			return {
				apps_total: appsTotalRow?.n ?? 0,
				users_total: usersTotalRow?.n ?? 0,
				active_users: activeRow?.n ?? 0,
				refresh_grants: refreshRow?.n ?? 0,
			};
		})(),
	]);

	let dbConnected = true;
	try {
		await db.execute(sql`SELECT 1`);
	} catch {
		dbConnected = false;
	}

	const traffic = cf
		? {
				requests_total: cf.totals.requests,
				bytes_out: cf.totals.bytesOut,
				by_status: bucketStatus(cf.byStatus),
				error_rate: (() => {
					const buckets = bucketStatus(cf.byStatus);
					const total =
						buckets["2xx"] + buckets["3xx"] + buckets["4xx"] + buckets["5xx"] + buckets.other;
					if (total === 0) return 0;
					return Number(((buckets["4xx"] + buckets["5xx"]) / total).toFixed(4));
				})(),
				edge_ttfb_p50_ms: cf.quantiles.ttfbP50Ms,
				edge_ttfb_p95_ms: cf.quantiles.ttfbP95Ms,
			}
		: null;

	const top_routes = cf
		? cf.topPaths.slice(0, 15).map((p) => ({
				path: p.path,
				requests: p.requests,
				origin_p50_ms: p.originP50Ms,
				origin_p95_ms: p.originP95Ms,
			}))
		: [];

	const top_clients = cf ? bucketUserAgents(cf.topUserAgents) : [];
	const geo_top = cf ? cf.topCountries.slice(0, 10) : [];

	c.header("Cache-Control", "no-store");
	return c.json({
		window,
		generated_at: new Date().toISOString(),
		traffic,
		top_routes,
		top_clients,
		geo_top,
		search_cache: {
			cached_embeddings: embCache.count,
			cached_embeddings_truncated: embCache.truncated,
			cached_counts: countCache.count,
			cached_counts_truncated: countCache.truncated,
		},
		auth: dbCounters,
		health: {
			db_connected: dbConnected,
			cf_analytics: cf ? "ok" : "unavailable",
		},
	});
});
