import { describe, expect, it } from "bun:test";
import { parseCfStats, windowToRange } from "../../src/lib/cf-analytics.ts";

describe("windowToRange", () => {
	it("computes 24h window by default", () => {
		const now = new Date("2026-05-08T12:00:00Z");
		const { start, end } = windowToRange("24h", now);
		expect(end).toBe("2026-05-08T12:00:00.000Z");
		expect(start).toBe("2026-05-07T12:00:00.000Z");
	});

	it("computes 1h window", () => {
		const now = new Date("2026-05-08T12:00:00Z");
		const { start } = windowToRange("1h", now);
		expect(start).toBe("2026-05-08T11:00:00.000Z");
	});

	it("computes 7d window", () => {
		const now = new Date("2026-05-08T12:00:00Z");
		const { start } = windowToRange("7d", now);
		expect(start).toBe("2026-05-01T12:00:00.000Z");
	});
});

describe("parseCfStats", () => {
	it("returns null when zone is missing", () => {
		expect(parseCfStats({})).toBeNull();
		expect(parseCfStats({ data: { viewer: { zones: [] } } })).toBeNull();
	});

	it("parses a complete response", () => {
		const result = parseCfStats({
			data: {
				viewer: {
					zones: [
						{
							totals: [
								{
									count: 42000,
									sum: { edgeResponseBytes: 12345678 },
									quantiles: {
										edgeTimeToFirstByteMsP50: 80,
										edgeTimeToFirstByteMsP95: 410,
									},
								},
							],
							byStatus: [
								{ count: 38000, dimensions: { edgeResponseStatus: 200 } },
								{ count: 3500, dimensions: { edgeResponseStatus: 404 } },
								{ count: 500, dimensions: { edgeResponseStatus: 500 } },
							],
							byPath: [
								{
									count: 18000,
									dimensions: { clientRequestPath: "/search/semantic" },
									quantiles: {
										originResponseDurationMsP50: 312,
										originResponseDurationMsP95: 1840,
									},
								},
								{
									count: 8000,
									dimensions: { clientRequestPath: "/paragraphs/1:0.1" },
								},
							],
							byUA: [
								{ count: 22000, dimensions: { userAgent: "claude-code/1.0" } },
								{ count: 9000, dimensions: { userAgent: "Mozilla/5.0 Chrome/130" } },
							],
							byCountry: [
								{ count: 30000, dimensions: { clientCountryName: "United States" } },
								{ count: 4000, dimensions: { clientCountryName: "Germany" } },
							],
						},
					],
				},
			},
		});

		if (!result) throw new Error("expected non-null result");
		expect(result.totals.requests).toBe(42000);
		expect(result.totals.bytesOut).toBe(12345678);
		expect(result.byStatus).toHaveLength(3);
		expect(result.topPaths[0]).toEqual({
			path: "/search/semantic",
			requests: 18000,
			originP50Ms: 312,
			originP95Ms: 1840,
		});
		expect(result.topPaths[1]?.originP50Ms).toBeNull();
		expect(result.topUserAgents[0]?.userAgent).toBe("claude-code/1.0");
		expect(result.topCountries[0]?.country).toBe("United States");
		expect(result.quantiles.ttfbP50Ms).toBe(80);
		expect(result.quantiles.ttfbP95Ms).toBe(410);
	});

	it("filters rows missing dimensions", () => {
		const result = parseCfStats({
			data: {
				viewer: {
					zones: [
						{
							totals: [{ count: 100 }],
							byStatus: [
								{ count: 50, dimensions: { edgeResponseStatus: 200 } },
								// biome-ignore lint/suspicious/noExplicitAny: testing malformed input
								{ count: 5 } as any,
							],
							byPath: [],
							byUA: [],
							byCountry: [],
						},
					],
				},
			},
		});
		if (!result) throw new Error("expected non-null result");
		expect(result.byStatus).toHaveLength(1);
	});

	it("treats GraphQL errors as missing zone (parser is response-only — fetcher handles errors)", () => {
		// parseCfStats runs after the fetcher confirms no errors; it should still
		// gracefully no-op if a malformed body sneaks through.
		expect(parseCfStats({ data: { viewer: undefined } })).toBeNull();
	});
});
