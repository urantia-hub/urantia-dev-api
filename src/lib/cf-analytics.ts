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
					quantiles {
						edgeTimeToFirstByteMsP50
						edgeTimeToFirstByteMsP95
					}
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
					quantiles {
						originResponseDurationMsP50
						originResponseDurationMsP95
					}
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

/**
 * Fetch + parse Cloudflare analytics for the given window.
 *
 * Returns null if the env isn't configured or the API call fails — callers
 * surface that as `cf_analytics: "unavailable"` rather than 500ing the whole
 * stats endpoint, since DB + KV signals are still useful on their own.
 */
export async function fetchCfStats(
	apiToken: string | undefined,
	zoneTag: string | undefined,
	window: CfWindow,
): Promise<CfStatsRaw | null> {
	if (!apiToken || !zoneTag) return null;

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
	} catch {
		return null;
	}

	if (!res.ok) return null;

	let body: GqlResponse;
	try {
		body = (await res.json()) as GqlResponse;
	} catch {
		return null;
	}
	if (body.errors?.length) return null;

	return parseCfStats(body);
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
