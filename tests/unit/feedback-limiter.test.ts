import { describe, expect, it } from "bun:test";
import {
	countRequest,
	FEEDBACK_CLIENT_RULES,
	FeedbackRateLimiter,
	type LimiterStorage,
	type WindowState,
} from "../../src/lib/feedback-limiter.ts";

const RULES = FEEDBACK_CLIENT_RULES;
const T0 = 1_800_000_000_000;

// Send `n` requests, `stepMs` apart, and return each decision.
function run(n: number, stepMs: number, start: WindowState[] = []) {
	let states: WindowState[] = start;
	const decisions = [];
	for (let i = 0; i < n; i++) {
		const d = countRequest(states, RULES, T0 + i * stepMs);
		states = d.states;
		decisions.push(d);
	}
	return decisions;
}

describe("countRequest", () => {
	it("allows five requests in a minute and blocks the sixth", () => {
		const allowed = run(6, 100).map((d) => d.allowed);
		expect(allowed).toEqual([true, true, true, true, true, false]);
	});

	it("tells a blocked client how many seconds remain in the minute", () => {
		const sixth = run(6, 1000)[5];
		expect(sixth?.allowed).toBe(false);
		expect(sixth?.retryAfterSeconds).toBe(55);
	});

	it("allows again when the minute ends", () => {
		const first = run(6, 100);
		const later = countRequest(first[5]?.states ?? [], RULES, T0 + 60_000);
		expect(later.allowed).toBe(true);
		expect(later.retryAfterSeconds).toBe(0);
	});

	it("blocks the eleventh request in 15 minutes, at a pace the minute window allows", () => {
		// One request per 70 seconds never has two in one minute window.
		const decisions = run(11, 70_000);
		expect(decisions.slice(0, 10).every((d) => d.allowed)).toBe(true);
		expect(decisions[10]?.allowed).toBe(false);
		// 15 minutes minus the 700 seconds that passed.
		expect(decisions[10]?.retryAfterSeconds).toBe(200);
	});

	it("counts a blocked request, so a client that keeps sending stays blocked", () => {
		const decisions = run(9, 100);
		expect(decisions.slice(5).every((d) => !d.allowed)).toBe(true);
		expect(decisions[8]?.states[0]?.count).toBe(9);
	});
});

// An in-memory stand-in for a Durable Object's storage.
function fakeStorage() {
	const data = new Map<string, unknown>();
	const alarms: number[] = [];
	const storage: LimiterStorage = {
		get: async <T>(key: string) => data.get(key) as T | undefined,
		put: async <T>(key: string, value: T) => {
			data.set(key, value);
		},
		deleteAll: async () => {
			data.clear();
		},
		setAlarm: async (time: number) => {
			alarms.push(time);
		},
	};
	return { data, alarms, storage };
}

const call = async (limiter: FeedbackRateLimiter) =>
	(await (await limiter.fetch(new Request("https://limiter/"))).json()) as {
		allowed: boolean;
		retryAfterSeconds: number;
	};

describe("FeedbackRateLimiter", () => {
	it("keeps its count across calls and blocks the sixth", async () => {
		const { storage } = fakeStorage();
		const limiter = new FeedbackRateLimiter({ storage });

		const results = [];
		for (let i = 0; i < 6; i++) results.push((await call(limiter)).allowed);
		expect(results).toEqual([true, true, true, true, true, false]);
	});

	it("keeps its count when a new instance loads the same storage", async () => {
		const { storage } = fakeStorage();
		for (let i = 0; i < 5; i++) await call(new FeedbackRateLimiter({ storage }));
		const sixth = await call(new FeedbackRateLimiter({ storage }));
		expect(sixth.allowed).toBe(false);
		expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("sets an alarm for the end of the longest window, and the alarm clears the data", async () => {
		const { storage, data, alarms } = fakeStorage();
		const limiter = new FeedbackRateLimiter({ storage });
		const before = Date.now();
		await call(limiter);

		expect(alarms.at(-1)).toBeGreaterThanOrEqual(before + 15 * 60_000);
		expect(data.size).toBe(1);
		await limiter.alarm();
		expect(data.size).toBe(0);
		expect((await call(limiter)).allowed).toBe(true);
	});
});
