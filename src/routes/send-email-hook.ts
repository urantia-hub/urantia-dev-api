import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client.ts";
import { apps } from "../db/schema.ts";
import { handleSendEmail, sendHtmlMail } from "../lib/mail/hook.ts";
import { nameForMail } from "../lib/mail/signin.ts";
import { readCapped } from "../lib/request-log.ts";
import { isFirstPartyApp } from "../lib/token-access.ts";
import type { Env } from "../types/env.ts";

// Supabase Auth calls this URL for each auth email (the "Send Email" hook), and this code writes and
// sends the email. It is not in the OpenAPI spec. The signature of Supabase is the only key:
// without the secret SEND_EMAIL_HOOK_SECRET, each request gets 401.
const MAX_BODY = 32_000;
const DEFAULT_FROM = "UrantiaHub <signin@accounts.urantiahub.com>";

export const sendEmailHookRoute = new Hono<Env>();

sendEmailHookRoute.post("/", async (c) => {
	// The call has no sign-in, so its size is checked first, and again as the body is read: a length
	// header can be absent or wrong.
	const tooLarge = () => c.json({ error: { http_code: 413, message: "Too large." } }, 413);
	if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return tooLarge();
	const stream = c.req.raw.body;
	const body = stream ? await readCapped(stream, MAX_BODY) : "";
	if (body === undefined) return tooLarge();
	const env = { ...process.env, ...(c.env ?? {}) } as Record<string, string | undefined>;

	// A failure here stops each sign-in by email. So it goes to the log of the service and to the
	// console, where "wrangler tail" shows it.
	const log = (message: string, fields?: Record<string, unknown>) => {
		console.warn(message, JSON.stringify(fields ?? {}));
		c.get("logger")?.warn(message, fields);
	};

	const answer = await handleSendEmail(
		{ body, header: (name) => c.req.header(name) },
		{
			secret: env.SEND_EMAIL_HOOK_SECRET,
			// The name of another app, only after a reviewer approved it. See nameForMail.
			appName: async (appId) => {
				const { db } = getDb(c.env?.HYPERDRIVE);
				const [app] = await db
					.select({ id: apps.id, name: apps.name, ownerId: apps.ownerId, status: apps.status })
					.from(apps)
					.where(eq(apps.id, appId))
					.limit(1);
				return nameForMail(
					app,
					!!app && isFirstPartyApp(app, env.FIRST_PARTY_APP_IDS, env.ADMIN_USER_IDS),
				);
			},
			send: (to, mail) =>
				sendHtmlMail(env, env.SIGNIN_FROM || DEFAULT_FROM, to, mail, fetch, (reason) =>
					log("send-email hook: the mail service did not take the email", { reason }),
				),
			log,
		},
	);
	return c.json(answer.body, answer.status);
});
