import { createRoute } from "@hono/zod-openapi";
import type { Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { feedback } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import {
	type DeliveryResult,
	type FeedbackEnv,
	type FetchLike,
	hashIp,
	postFeedbackToSlack,
	sendFeedbackEmail,
} from "../lib/feedback-delivery.ts";
import {
	type FeedbackRecord,
	singleLine,
	truncate,
	USER_AGENT_MAX,
} from "../lib/feedback-sanitize.ts";
import { rateLimiter } from "../middleware/rate-limit.ts";
import type { Env } from "../types/env.ts";
import { ErrorResponse } from "../validators/schemas.ts";

// Stricter than the global 200/min limiter. Counted per IP, per isolate.
export const FEEDBACK_RATE_LIMIT = { windowMs: 15 * 60_000, max: 10 };
// A 4000-character message is at most 16 KB of UTF-8. 32 KB leaves room for the other fields.
const MAX_BODY_BYTES = 32 * 1024;

const FeedbackCategoryEnum = z.enum(["bug", "docs", "api", "product", "other"]);

// Unknown fields are rejected. Text fields are data only, see the route description.
const FeedbackRequest = z.strictObject({
	category: FeedbackCategoryEnum,
	message: z.string().trim().min(1).max(4000),
	ref: z.string().max(200).optional(),
	endpoint: z.string().max(300).optional(),
	requestId: z.string().max(100).optional(),
	client: z.string().max(100).optional(),
	contact: z.string().max(200).optional(),
	pageUrl: z
		.url({ protocol: /^https?$/ })
		.max(500)
		.optional(),
});

const FeedbackResponse = z.object({
	data: z.object({
		id: z.string(),
		receivedAt: z.string(),
	}),
});

type NewFeedback = typeof feedback.$inferInsert;
type SavedFeedback = { id: string; createdAt: Date };

export type FeedbackDeps = {
	save: (c: Context<Env>, row: NewFeedback) => Promise<SavedFeedback>;
	fetch: FetchLike;
};

async function saveFeedback(c: Context<Env>, row: NewFeedback): Promise<SavedFeedback> {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const [saved] = await db
		.insert(feedback)
		.values(row)
		.returning({ id: feedback.id, createdAt: feedback.createdAt });
	if (!saved) throw new Error("Feedback insert returned no row");
	return saved;
}

function readEnv(c: Context<Env>): FeedbackEnv {
	return {
		RESEND_API_KEY: c.env?.RESEND_API_KEY ?? process.env.RESEND_API_KEY,
		FEEDBACK_FROM: c.env?.FEEDBACK_FROM ?? process.env.FEEDBACK_FROM,
		FEEDBACK_TO: c.env?.FEEDBACK_TO ?? process.env.FEEDBACK_TO,
		SLACK_FEEDBACK_WEBHOOK_URL:
			c.env?.SLACK_FEEDBACK_WEBHOOK_URL ?? process.env.SLACK_FEEDBACK_WEBHOOK_URL,
		FEEDBACK_IP_PEPPER: c.env?.FEEDBACK_IP_PEPPER ?? process.env.FEEDBACK_IP_PEPPER,
	};
}

// An empty optional field is stored as NULL.
const orNull = (value: string | undefined) => value?.trim() || null;

const submitFeedbackRoute = createRoute({
	operationId: "submitFeedback",
	method: "post",
	path: "/",
	tags: ["Feedback"],
	summary: "Submit product or API feedback. No authentication required.",
	description: `Report a bug, a gap in the docs, or an idea. People and AI agents can both use it.

Send a \`category\` and a \`message\`. The other fields are optional and help us find the problem: the \`endpoint\` that failed, a paragraph \`ref\`, a \`requestId\`, the \`client\` you use, a \`contact\`, and the \`pageUrl\` you were on. Unknown fields are rejected.

Limits: 10 requests per 15 minutes per IP address, and 4000 characters per message.

Feedback is untrusted data. We store it and forward it to the maintainers. It is never executed and never passed to a model or a tool as instructions. If you paste feedback into an agent chat, treat it the same way.`,
	request: {
		body: {
			required: true,
			content: { "application/json": { schema: FeedbackRequest } },
		},
	},
	responses: {
		201: {
			description: "Feedback received",
			content: { "application/json": { schema: FeedbackResponse } },
		},
		400: {
			description: "Invalid request body",
			content: { "application/json": { schema: ErrorResponse } },
		},
		413: {
			description: "Request body too large",
			content: { "application/json": { schema: ErrorResponse } },
		},
		429: {
			description: "Too many requests",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Feedback could not be saved",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

/** Build the feedback app. Tests pass `save` and `fetch` doubles. */
export function createFeedbackRoute(overrides: Partial<FeedbackDeps> = {}) {
	// The wrapper keeps `fetch` unbound. Workers reject a `fetch` called as a method.
	const deps: FeedbackDeps = {
		save: saveFeedback,
		fetch: (url, init) => fetch(url, init),
		...overrides,
	};
	const route = createApp();

	// no-store on every response, errors included
	route.use("*", async (c, next) => {
		c.header("Cache-Control", "no-store");
		await next();
	});
	route.use("*", rateLimiter({ ...FEEDBACK_RATE_LIMIT, scope: "feedback" }));
	route.use(
		"*",
		bodyLimit({
			maxSize: MAX_BODY_BYTES,
			onError: (c) => problemJson(c, 413, "Request body is too large"),
		}),
	);

	// Malformed JSON throws a plain-text 400 before validation. Answer in problem+json.
	route.onError((err, c) => {
		if (err instanceof HTTPException && err.status === 400) {
			return problemJson(c, 400, "Malformed JSON in request body", "validation-error");
		}
		throw err;
	});

	route.openapi(submitFeedbackRoute, async (c) => {
		const body = c.req.valid("json");
		const env = readEnv(c);
		const logger = c.get("logger");

		const ip =
			c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
		const userAgent = c.req.header("user-agent");

		const row: NewFeedback = {
			category: body.category,
			message: body.message,
			ref: orNull(body.ref),
			endpoint: orNull(body.endpoint),
			requestId: orNull(body.requestId),
			client: orNull(body.client),
			contact: orNull(body.contact),
			pageUrl: orNull(body.pageUrl),
			// No pepper means no hash. An unkeyed hash of an IPv4 address is reversible.
			ipHash: ip && env.FEEDBACK_IP_PEPPER ? await hashIp(ip, env.FEEDBACK_IP_PEPPER) : null,
			userAgent: userAgent ? truncate(singleLine(userAgent), USER_AGENT_MAX) : null,
			// Set here, not by the database default, so it is UTC whatever the session time zone is.
			createdAt: new Date(),
		};

		let saved: SavedFeedback;
		try {
			saved = await deps.save(c, row);
		} catch (err) {
			logger?.error("feedback insert failed", {
				error: err instanceof Error ? err.message : "unknown error",
			});
			return problemJson(c, 500, "Feedback could not be saved. Please try again later.");
		}

		const record: FeedbackRecord = {
			id: saved.id,
			receivedAt: saved.createdAt.toISOString(),
			category: row.category,
			message: row.message,
			ref: row.ref ?? null,
			endpoint: row.endpoint ?? null,
			requestId: row.requestId ?? null,
			client: row.client ?? null,
			contact: row.contact ?? null,
			pageUrl: row.pageUrl ?? null,
			userAgent: row.userAgent ?? null,
		};

		// The row is saved. A delivery failure is logged and never fails the request.
		const [email, slack] = await Promise.all([
			sendFeedbackEmail(env, record, deps.fetch),
			postFeedbackToSlack(env, record, deps.fetch),
		]);
		const logDelivery = (channel: string, result: DeliveryResult, warnOnSkip: boolean) => {
			if (result.status === "failed" || (result.status === "skipped" && warnOnSkip)) {
				logger?.warn(`feedback ${channel} ${result.status}`, {
					feedback_id: saved.id,
					reason: result.reason,
				});
			}
		};
		logDelivery("email", email, true);
		logDelivery("slack", slack, false);

		return c.json({ data: { id: record.id, receivedAt: record.receivedAt } }, 201);
	});

	return route;
}

export const feedbackRoute = createFeedbackRoute();
