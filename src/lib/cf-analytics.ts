/**
 * Cloudflare GraphQL Analytics client for /admin/stats.
 *
 * Reads from the `httpRequestsAdaptiveGroups` dataset, which is sampled but
 * carries the dimensions we need (path, user-agent, status, country) and
 * latency quantiles. Sampling is fine for curiosity-level dashboards;
 * we never expose individual rows so privacy isn't degraded by it.
 *
 * Docs: https://developers.cloudflare.com/analytics/graphql-api/
 */

const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

export type CfWindow = "1h" | "24h" | "7d";

export interface CfStatsRaw {
	totals: { requests: number; bytesOut: number };
	byStatus: Array<{ status: number; requests: number }>;
	topPaths: Array<{
		path: string;
		requests: number;
		originP50Ms: number | null;
		originP95Ms: number | null;
	}>;
	topUserAgents: Array<{ userAgent: string; requests: number }>;
	topCountries: Array<{ country: string; requests: number }>;
	quantiles: { ttfbP50Ms: number | null; ttfbP95Ms: number | null };
}

interface GqlGroupRow<D extends Record<string, unknown>> {
	count: number;
	dimensions?: D;
	sum?: { edgeResponseBytes?: number };
	quantiles?: {
		edgeTimeToFirstByteMsP50?: number;
		edgeTimeToFirstByteMsP95?: number;
		originResponseDurationMsP50?: number;
		originResponseDurationMsP95?: number;
	};
}

interface GqlResponse {
	data?: {
		viewer?: {
			zones?: Array<{
				totals?: Array<GqlGroupRow<Record<string, never>>>;
				byStatus?: Array<GqlGroupRow<{ edgeResponseStatus: number }>>;
				byPath?: Array<GqlGroupRow<{ clientRequestPath: string }>>;
				byUA?: Array<GqlGroupRow<{ userAgent: string }>>;
				byCountry?: Array<GqlGroupRow<{ clientCountryName: string }>>;
			}>;
		};
	};
	errors?: Array<{ message: string }>;
}

// Note on latency: CF Free plan does NOT expose quantile fields
// (edgeTimeToFirstByteMs*, originResponseDurationMs*). Adding them back
// requires CF Pro+. For now, latency lives in BetterStack only.
const QUERY = /* GraphQL */ `
	query Stats($zoneTag: String!, $start: Time!, $end: Time!) {
		viewer {
			zones(filter: { zoneTag: $zoneTag }) {
				totals: httpRequestsAdaptiveGroups(
					limit: 1
					filter: { datetime_geq: $start, datetime_lt: $end }
				) {
					count
					sum { edgeResponseBytes }
				}
				byStatus: httpRequestsAdaptiveGroups(
					limit: 50
					filter: { datetime_geq: $start, datetime_lt: $end }
					orderBy: [count_DESC]
				) {
					count
					dimensions { edgeResponseStatus }
				}
				byPath: httpRequestsAdaptiveGroups(
					limit: 50
					filter: { datetime_geq: $start, datetime_lt: $end }
					orderBy: [count_DESC]
				) {
					count
					dimensions { clientRequestPath }
				}
				byUA: httpRequestsAdaptiveGroups(
					limit: 50
					filter: { datetime_geq: $start, datetime_lt: $end }
					orderBy: [count_DESC]
				) {
					count
					dimensions { userAgent }
				}
				byCountry: httpRequestsAdaptiveGroups(
					limit: 20
					filter: { datetime_geq: $start, datetime_lt: $end }
					orderBy: [count_DESC]
				) {
					count
					dimensions { clientCountryName }
				}
			}
		}
	}
`;

export function windowToRange(
	window: CfWindow,
	now: Date = new Date(),
): { start: string; end: string } {
	const ms =
		window === "1h"
			? 60 * 60 * 1000
			: window === "7d"
				? 7 * 24 * 60 * 60 * 1000
				: 24 * 60 * 60 * 1000;
	return {
		start: new Date(now.getTime() - ms).toISOString(),
		end: now.toISOString(),
	};
}

export type CfStatsResult =
	| { ok: true; stats: CfStatsRaw }
	| { ok: false; error: string };

/**
 * Fetch + parse Cloudflare analytics for the given window.
 *
 * Returns a tagged result so callers can surface the failure reason (admin
 * sees it for debugging; the rest of the stats response degrades gracefully).
 */
export async function fetchCfStats(
	apiToken: string | undefined,
	zoneTag: string | undefined,
	window: CfWindow,
): Promise<CfStatsResult> {
	if (!apiToken) return { ok: false, error: "missing CF_ANALYTICS_API_TOKEN" };
	if (!zoneTag) return { ok: false, error: "missing CF_ZONE_TAG" };

	const { start, end } = windowToRange(window);
	let res: Response;
	try {
		res = await fetch(ENDPOINT, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiToken}`,
			},
			body: JSON.stringify({ query: QUERY, variables: { zoneTag, start, end } }),
		});
	} catch (err) {
		return { ok: false, error: `fetch failed: ${err instanceof Error ? err.message : String(err)}` };
	}

	if (!res.ok) {
		return { ok: false, error: `http ${res.status} from CF GraphQL API` };
	}

	let body: GqlResponse;
	try {
		body = (await res.json()) as GqlResponse;
	} catch {
		return { ok: false, error: "invalid JSON response from CF GraphQL API" };
	}
	if (body.errors?.length) {
		return { ok: false, error: `graphql: ${body.errors.map((e) => e.message).join("; ")}` };
	}

	const stats = parseCfStats(body);
	if (!stats) {
		return { ok: false, error: "CF GraphQL returned no zone — check CF_ZONE_TAG matches the api.urantia.dev zone" };
	}
	return { ok: true, stats };
}

export function parseCfStats(body: GqlResponse): CfStatsRaw | null {
	const zone = body.data?.viewer?.zones?.[0];
	if (!zone) return null;

	const totalsRow = zone.totals?.[0];
	const totals = {
		requests: totalsRow?.count ?? 0,
		bytesOut: totalsRow?.sum?.edgeResponseBytes ?? 0,
	};

	const byStatus = (zone.byStatus ?? []).flatMap((r) => {
		const status = r.dimensions?.edgeResponseStatus;
		return status == null ? [] : [{ status, requests: r.count }];
	});

	const topPaths = (zone.byPath ?? []).flatMap((r) => {
		const path = r.dimensions?.clientRequestPath;
		if (path == null) return [];
		return [
			{
				path,
				requests: r.count,
				originP50Ms: r.quantiles?.originResponseDurationMsP50 ?? null,
				originP95Ms: r.quantiles?.originResponseDurationMsP95 ?? null,
			},
		];
	});

	const topUserAgents = (zone.byUA ?? []).flatMap((r) => {
		const userAgent = r.dimensions?.userAgent;
		return userAgent == null ? [] : [{ userAgent, requests: r.count }];
	});

	const topCountries = (zone.byCountry ?? []).flatMap((r) => {
		const country = r.dimensions?.clientCountryName;
		return country == null ? [] : [{ country, requests: r.count }];
	});

	return {
		totals,
		byStatus,
		topPaths,
		topUserAgents,
		topCountries,
		quantiles: {
			ttfbP50Ms: totalsRow?.quantiles?.edgeTimeToFirstByteMsP50 ?? null,
			ttfbP95Ms: totalsRow?.quantiles?.edgeTimeToFirstByteMsP95 ?? null,
		},
	};
}
