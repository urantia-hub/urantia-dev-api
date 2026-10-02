/**
 * A strongly consistent rate limiter for POST /feedback, as a Durable Object.
 *
 * Why not the Workers Rate Limiting binding alone: it keeps its counters on
 * each machine and syncs them in the background. Production spreads one
 * client's requests over many isolates, so a low limit such as 5 per minute
 * almost never trips (measured 2026-10-02: 2 blocked out of 45 in 50 seconds).
 * One Durable Object instance per client sees every request for that client.
 *
 * The class has no Cloudflare imports, so the same module loads under Bun.
 */

export type WindowRule = { limit: number; windowMs: number };
export type WindowState = { count: number; resetAt: number };

// Per client: 5 requests per minute, and 10 requests per 15 minutes.
export const FEEDBACK_CLIENT_RULES: readonly WindowRule[] = [
	{ limit: 5, windowMs: 60_000 },
	{ limit: 10, windowMs: 15 * 60_000 },
];

export type LimitDecision = {
	allowed: boolean;
	// Seconds until the client can send again. 0 when allowed.
	retryAfterSeconds: number;
	states: WindowState[];
};

/**
 * Count one request against every window. Fixed windows: a window starts with
 * its first request and ends `windowMs` later. A blocked request still counts.
 */
export function countRequest(
	previous: readonly (WindowState | undefined)[],
	rules: readonly WindowRule[],
	now: number,
): LimitDecision {
	let retryAfterMs = 0;
	const states = rules.map((rule, i) => {
		const old = previous[i];
		const state =
			old && now < old.resetAt
				? { count: old.count + 1, resetAt: old.resetAt }
				: { count: 1, resetAt: now + rule.windowMs };
		if (state.count > rule.limit) retryAfterMs = Math.max(retryAfterMs, state.resetAt - now);
		return state;
	});
	return { allowed: retryAfterMs === 0, retryAfterSeconds: Math.ceil(retryAfterMs / 1000), states };
}

// The part of DurableObjectState this class uses. Tests pass a double.
export type LimiterStorage = {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	deleteAll(): Promise<void>;
	setAlarm(scheduledTime: number): Promise<void>;
};

const STATE_KEY = "windows";

export class FeedbackRateLimiter {
	private readonly storage: LimiterStorage;

	constructor(state: { storage: LimiterStorage }) {
		this.storage = state.storage;
	}

	// One call counts one request. The rules are fixed here, never taken from the caller.
	async fetch(_request: Request): Promise<Response> {
		const now = Date.now();
		const previous = (await this.storage.get<WindowState[]>(STATE_KEY)) ?? [];
		const decision = countRequest(previous, FEEDBACK_CLIENT_RULES, now);
		await this.storage.put(STATE_KEY, decision.states);
		// Remove the stored counters after the last window ends, so idle objects hold no data.
		await this.storage.setAlarm(Math.max(...decision.states.map((s) => s.resetAt)));

		return Response.json({
			allowed: decision.allowed,
			retryAfterSeconds: decision.retryAfterSeconds,
		});
	}

	async alarm(): Promise<void> {
		await this.storage.deleteAll();
	}
}
