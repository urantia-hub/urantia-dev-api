import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { app } from "../../src/index.ts";
import { createFeedbackRoute, FEEDBACK_RATE_LIMIT } from "../../src/routes/feedback.ts";
import type { Env } from "../../src/types/env.ts";
import { assertProblemShape } from "../helpers/shapes.ts";

/**
 * POST /feedback.
 *
 * The handler tests use `save` and `fetch` doubles, so no test writes to the
 * database, sends an email, or posts to Slack. The tests against the real app
 * send only requests that fail before the handler runs.
 */

const VALID = {
	category: "bug",
	message: "search returns 500 for phrase mode",
	endpoint: "/search",
	client: "curl",
};

const SAVED = {
	id: "abc12345-0000-4000-8000-000000000000",
	createdAt: new Date("2026-10-02T12:00:00.000Z"),
};

// Empty strings override any value a local .env puts in process.env.
const NO_DELIVERY = {
	RESEND_API_KEY: "",
	FEEDBACK_FROM: "",
	FEEDBACK_TO: "",
	SLACK_FEEDBACK_WEBHOOK_URL: "",
	FEEDBACK_IP_PEPPER: "",
};

const FULL_DELIVERY = {
	RESEND_API_KEY: "re_test_key",
	FEEDBACK_FROM: "feedback@example.com",
	FEEDBACK_TO: "team@example.com",
	SLACK_FEEDBACK_WEBHOOK_URL: "https://hooks.slack.com/services/T/B/x",
	FEEDBACK_IP_PEPPER: "pepper",
};

// Each test uses its own IP so the per-IP feedback limiter does not carry over.
let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

function harness(opts: { saveFails?: boolean; fetchStatus?: number } = {}) {
	const rows: Array<Record<string, unknown>> = [];
	const calls: Array<{ url: string; body: Record<string, unknown> }> = [];

	const route = createFeedbackRoute({
		save: async (_c, row) => {
			if (opts.saveFails) throw new Error("connection refused");
			rows.push(row);
			return SAVED;
		},
		fetch: async (url, init) => {
			calls.push({ url, body: JSON.parse(init.body as string) });
			return new Response("{}", { status: opts.fetchStatus ?? 200 });
		},
	});

	const send = (body: unknown, env: Record<string, string> = NO_DELIVERY, ip = nextIp()) =>
		route.request(
			"/",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"cf-connecting-ip": ip,
					"User-Agent": "feedback-test/1.0",
				},
				body: JSON.stringify(body),
			},
			env,
		);

	return { rows, calls, send, route };
}

function postToApp(body: unknown, ip = nextIp()) {
	return app.request("/feedback", {
		method: "POST",
		headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
		body: JSON.stringify(body),
	});
}

describe("POST /feedback (handler)", () => {
	it("saves the feedback and returns 201 with the id and the timestamp", async () => {
		const { rows, send } = harness();
		const res = await send(VALID);

		expect(res.status).toBe(201);
		expect((await res.json()) as unknown).toEqual({
			data: { id: SAVED.id, receivedAt: "2026-10-02T12:00:00.000Z" },
		});
		expect(res.headers.get("cache-control")).toBe("no-store");

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			category: "bug",
			message: "search returns 500 for phrase mode",
			endpoint: "/search",
			client: "curl",
			ref: null,
			requestId: null,
			contact: null,
			pageUrl: null,
			userAgent: "feedback-test/1.0",
		});
		expect(rows[0]?.createdAt).toBeInstanceOf(Date);
	});

	it("returns 201 and sends nothing when no delivery secret is set", async () => {
		const { rows, calls, send } = harness();
		const res = await send(VALID, NO_DELIVERY);

		expect(res.status).toBe(201);
		expect(rows).toHaveLength(1);
		expect(calls).toHaveLength(0);
	});

	it("stores no IP hash when the pepper is not set", async () => {
		const { rows, send } = harness();
		await send(VALID, NO_DELIVERY);
		expect(rows[0]?.ipHash).toBeNull();
	});

	it("stores a keyed hash of the IP, never the raw IP", async () => {
		const { rows, send } = harness();
		const ip = nextIp();
		await send(VALID, FULL_DELIVERY, ip);

		expect(rows[0]?.ipHash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(rows[0])).not.toContain(ip);
	});

	it("emails and posts to Slack when both are configured", async () => {
		const { calls, send } = harness();
		const res = await send(
			{ ...VALID, message: "<script>alert(1)</script> **@everyone**" },
			FULL_DELIVERY,
		);
		expect(res.status).toBe(201);

		const email = calls.find((call) => call.url === "https://api.resend.com/emails");
		const slack = calls.find((call) => call.url === FULL_DELIVERY.SLACK_FEEDBACK_WEBHOOK_URL);
		expect(calls).toHaveLength(2);

		expect(email?.body.subject).toBe("[Urantia feedback] bug · abc12345");
		expect(email?.body.html).toBeUndefined();
		expect(email?.body.text).toContain("--- BEGIN UNTRUSTED FEEDBACK ---");

		expect(slack?.body.text).not.toContain("<script>");
		expect(slack?.body.text).not.toContain("@everyone");
	});

	it("returns 201 when the email and Slack requests fail", async () => {
		const { rows, calls, send } = harness({ fetchStatus: 500 });
		const res = await send(VALID, FULL_DELIVERY);

		expect(res.status).toBe(201);
		expect(rows).toHaveLength(1);
		expect(calls).toHaveLength(2);
	});

	it("returns 500 problem+json and sends nothing when the insert fails", async () => {
		const { calls, send } = harness({ saveFails: true });
		const res = await send(VALID, FULL_DELIVERY);

		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toContain("application/problem+json");
		const json = (await res.json()) as Record<string, string>;
		assertProblemShape(json);
		expect(json.detail).not.toContain("connection refused");
		expect(calls).toHaveLength(0);
	});

	it("stores the camelCase optional fields", async () => {
		const { rows, send } = harness();
		const res = await send({
			...VALID,
			ref: "196:2.1",
			requestId: "8f2c1a7e-ray",
			contact: "reader@example.com",
			pageUrl: "https://urantia.dev/docs",
		});

		expect(res.status).toBe(201);
		expect(rows[0]).toMatchObject({
			ref: "196:2.1",
			requestId: "8f2c1a7e-ray",
			contact: "reader@example.com",
			pageUrl: "https://urantia.dev/docs",
		});
	});

	it("trims the message and stores an empty optional field as NULL", async () => {
		const { rows, send } = harness();
		await send({ category: "docs", message: "  typo in the quickstart  ", contact: "  " });

		expect(rows[0]?.message).toBe("typo in the quickstart");
		expect(rows[0]?.contact).toBeNull();
	});

	it("truncates the user agent to 300 characters", async () => {
		const { rows, route } = harness();
		await route.request(
			"/",
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"cf-connecting-ip": nextIp(),
					"User-Agent": "a".repeat(1000),
				},
				body: JSON.stringify(VALID),
			},
			NO_DELIVERY,
		);
		expect(rows[0]?.userAgent).toBe(`${"a".repeat(300)}…`);
	});

	it("returns 413 for a body over the size cap", async () => {
		const { rows, send } = harness();
		const res = await send({ ...VALID, message: "x".repeat(40_000) });

		expect(res.status).toBe(413);
		assertProblemShape((await res.json()) as Record<string, unknown>);
		expect(rows).toHaveLength(0);
	});

	it("returns 429 after 10 requests from one IP and leaves other IPs alone", async () => {
		const { send } = harness();
		const ip = nextIp();

		for (let i = 0; i < FEEDBACK_RATE_LIMIT.max; i++) {
			const res = await send(VALID, NO_DELIVERY, ip);
			expect(res.status).toBe(201);
		}

		const limited = await send(VALID, NO_DELIVERY, ip);
		expect(limited.status).toBe(429);
		expect(limited.headers.get("x-ratelimit-limit")).toBe("10");
		expect(limited.headers.get("cache-control")).toBe("no-store");
		assertProblemShape((await limited.json()) as Record<string, unknown>);

		expect((await send(VALID, NO_DELIVERY)).status).toBe(201);
	});
});

describe("POST /feedback (Cloudflare limiters)", () => {
	type Behavior = "allow" | "block" | "throw" | "hang" | "http-500";

	// A stand-in for the Durable Object namespace. It records each object name.
	function namespace(behavior: Behavior) {
		const names: string[] = [];
		return {
			names,
			idFromName: (name: string) => {
				names.push(name);
				return name;
			},
			get: () => ({
				fetch: async () => {
					if (behavior === "throw") throw new Error("object unavailable");
					if (behavior === "hang") return new Promise<Response>(() => {});
					if (behavior === "http-500") return new Response("broken", { status: 500 });
					return Response.json({
						allowed: behavior === "allow",
						retryAfterSeconds: behavior === "allow" ? 0 : 42,
					});
				},
			}),
		};
	}

	// A stand-in for the Workers Rate Limiting binding.
	function binding(behavior: "allow" | "block" | "throw") {
		const keys: string[] = [];
		return {
			keys,
			limit: async ({ key }: { key: string }) => {
				keys.push(key);
				if (behavior === "throw") throw new Error("binding unavailable");
				return { success: behavior === "allow" };
			},
		};
	}

	// The route with a logger that records each warning.
	function sendWith(bindings: Record<string, unknown>, ip = nextIp()) {
		const rows: unknown[] = [];
		const warnings: Array<{ message: string; context?: Record<string, unknown> }> = [];
		const route = createFeedbackRoute({
			save: async (_c, row) => {
				rows.push(row);
				return SAVED;
			},
			fetch: async () => new Response("{}"),
		});
		const host = new Hono<Env>();
		host.use("*", async (c, next) => {
			c.set("logger", {
				info() {},
				debug() {},
				error() {},
				// Keep the limiter warnings only. The handler also warns when email is not set up.
				warn: (message, context) => {
					if (String(message).includes("limiter"))
						warnings.push({ message: String(message), context });
				},
			});
			await next();
		});
		host.route("/", route);

		const res = host.request(
			"/",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
				body: JSON.stringify(VALID),
			},
			{ ...NO_DELIVERY, ...bindings },
		);
		return { rows, warnings, res };
	}

	it("counts each client in its own Durable Object, named by IP", async () => {
		const limiter = namespace("allow");
		const ip = nextIp();
		const { rows, warnings, res } = sendWith({ FEEDBACK_LIMITER: limiter }, ip);

		expect((await res).status).toBe(201);
		expect(rows).toHaveLength(1);
		expect(limiter.names).toEqual([`ip:${ip}`]);
		expect(warnings).toHaveLength(0);
	});

	it("returns 429 problem+json with Retry-After and saves nothing when the limiter blocks", async () => {
		const { rows, res } = sendWith({ FEEDBACK_LIMITER: namespace("block") });
		const response = await res;

		expect(response.status).toBe(429);
		expect(response.headers.get("retry-after")).toBe("42");
		expect(response.headers.get("content-type")).toContain("application/problem+json");
		expect(response.headers.get("cache-control")).toBe("no-store");
		assertProblemShape((await response.json()) as Record<string, unknown>);
		expect(rows).toHaveLength(0);
	});

	it("blocks an invalid request too, before validation", async () => {
		const route = createFeedbackRoute({
			save: async () => SAVED,
			fetch: async () => new Response("{}"),
		});
		const res = await route.request(
			"/",
			{
				method: "POST",
				headers: { "Content-Type": "application/json", "cf-connecting-ip": nextIp() },
				body: JSON.stringify({ category: "other", message: "" }),
			},
			{ ...NO_DELIVERY, FEEDBACK_LIMITER: namespace("block") },
		);
		expect(res.status).toBe(429);
	});

	for (const fault of ["throw", "hang", "http-500"] as const) {
		it(`accepts the request and logs a warning when the limiter fault is "${fault}"`, async () => {
			const { rows, warnings, res } = sendWith({ FEEDBACK_LIMITER: namespace(fault) });

			expect((await res).status).toBe(201);
			expect(rows).toHaveLength(1);
			expect(warnings.map((w) => w.message)).toEqual(["feedback limiter failed, request allowed"]);
			expect(String(warnings[0]?.context?.error)).not.toBe("");
		});
	}

	it("answers a hung limiter within the timeout, not never", async () => {
		const started = Date.now();
		const { res } = sendWith({ FEEDBACK_LIMITER: namespace("hang") });
		expect((await res).status).toBe(201);
		expect(Date.now() - started).toBeLessThan(3000);
	});

	it("logs a warning when the binding is missing on Workers", async () => {
		// HYPERDRIVE is bound on Workers only, so its presence marks the Workers runtime.
		const { warnings, res } = sendWith({ HYPERDRIVE: {} });
		expect((await res).status).toBe(201);
		expect(warnings.map((w) => w.message)).toEqual([
			"feedback limiter binding is missing, request allowed",
		]);
	});

	it("logs nothing when the binding is missing under Bun", async () => {
		const { warnings, res } = sendWith({});
		expect((await res).status).toBe(201);
		expect(warnings).toHaveLength(0);
	});

	it("returns 429 when the total-volume cap blocks, keyed by one shared key", async () => {
		const cap = binding("block");
		const { rows, res } = sendWith({
			FEEDBACK_LIMITER: namespace("allow"),
			FEEDBACK_GLOBAL_LIMITER: cap,
		});

		expect((await res).status).toBe(429);
		expect(rows).toHaveLength(0);
		expect(cap.keys).toEqual(["all"]);
	});

	it("accepts the request and logs a warning when the total-volume cap throws", async () => {
		const { rows, warnings, res } = sendWith({ FEEDBACK_GLOBAL_LIMITER: binding("throw") });

		expect((await res).status).toBe(201);
		expect(rows).toHaveLength(1);
		expect(warnings.map((w) => w.message)).toEqual([
			"feedback global limiter failed, request allowed",
		]);
	});
});

describe("POST /feedback (validation, real app)", () => {
	const INVALID: Array<[string, unknown]> = [
		["an empty message", { category: "bug", message: "" }],
		["a whitespace-only message", { category: "bug", message: "   " }],
		["a message over 4000 characters", { category: "bug", message: "x".repeat(4001) }],
		["a missing message", { category: "bug" }],
		["a missing category", { message: "hello" }],
		["an unknown category", { category: "spam", message: "hello" }],
		["an unknown field", { category: "bug", message: "hello", is_admin: true }],
		["the snake_case name request_id", { category: "bug", message: "hello", request_id: "abc" }],
		[
			"the snake_case name page_url",
			{ category: "bug", message: "hello", page_url: "https://urantia.dev" },
		],
		["a ref over 200 characters", { category: "bug", message: "hello", ref: "x".repeat(201) }],
		[
			"a client over 100 characters",
			{ category: "bug", message: "hello", client: "x".repeat(101) },
		],
		["a pageUrl that is not a URL", { category: "bug", message: "hello", pageUrl: "not a url" }],
		[
			"a pageUrl that is not http or https",
			{ category: "bug", message: "hello", pageUrl: "javascript:alert(1)" },
		],
	];

	for (const [name, body] of INVALID) {
		it(`returns 400 problem+json for ${name}`, async () => {
			const res = await postToApp(body);
			expect(res.status).toBe(400);
			expect(res.headers.get("content-type")).toContain("application/problem+json");
			expect(res.headers.get("cache-control")).toBe("no-store");
			assertProblemShape((await res.json()) as Record<string, unknown>);
		});
	}

	it("returns 400 for malformed JSON", async () => {
		const res = await app.request("/feedback", {
			method: "POST",
			headers: { "Content-Type": "application/json", "cf-connecting-ip": nextIp() },
			body: "{not json",
		});
		expect(res.status).toBe(400);
		expect(res.headers.get("content-type")).toContain("application/problem+json");
		assertProblemShape((await res.json()) as Record<string, unknown>);
	});

	it("counts the feedback limit apart from the global limit", async () => {
		const ip = nextIp();
		const first = await postToApp({ category: "bug", message: "" }, ip);
		expect(first.headers.get("x-ratelimit-limit")).toBe("10");
		expect(first.headers.get("x-ratelimit-remaining")).toBe("9");

		// A request to another route does not use the feedback budget.
		await app.request("/", { headers: { "cf-connecting-ip": ip } });
		const second = await postToApp({ category: "bug", message: "" }, ip);
		expect(second.headers.get("x-ratelimit-remaining")).toBe("8");
	});
});

describe("POST /feedback (OpenAPI)", () => {
	it("appears in the spec under the Feedback tag", async () => {
		const res = await app.request("/openapi.json");
		// biome-ignore lint/suspicious/noExplicitAny: the spec is read loosely
		const spec = (await res.json()) as any;
		const operation = spec.paths["/feedback"]?.post;

		expect(operation).toBeDefined();
		expect(operation.tags).toEqual(["Feedback"]);
		expect(operation.operationId).toBe("submitFeedback");
		expect(operation.requestBody.required).toBe(true);
		expect(Object.keys(operation.responses)).toContain("201");
	});
});
