import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getDb } from "../db/client.ts";
import { apps } from "../db/schema.ts";
import { handleSendEmail, sendHtmlMail } from "../lib/mail/hook.ts";
import { isFirstPartyApp } from "../lib/token-access.ts";
import type { Env } from "../types/env.ts";

// Supabase Auth calls this URL for each auth email (the "Send Email" hook), and this code writes and
// sends the email. It is not in the OpenAPI spec. The signature of Supabase is the only key:
// without the secret SEND_EMAIL_HOOK_SECRET, each request gets 401.
const MAX_BODY = 32_000;
const DEFAULT_FROM = "UrantiaHub <signin@accounts.urantiahub.com>";

export const sendEmailHookRoute = new Hono<Env>();

sendEmailHookRoute.post("/", async (c) => {
	const body = await c.req.text();
	if (body.length > MAX_BODY)
		return c.json({ error: { http_code: 400, message: "Too large." } }, 400);
	const env = { ...process.env, ...(c.env ?? {}) } as Record<string, string | undefined>;

	const answer = await handleSendEmail(
		{ body, header: (name) => c.req.header(name) },
		{
			secret: env.SEND_EMAIL_HOOK_SECRET,
			// The name of another app. An app of ours, and one that is not known, has no line in the email.
			appName: async (appId) => {
				const { db } = getDb(c.env?.HYPERDRIVE);
				const [app] = await db
					.select({ id: apps.id, name: apps.name, ownerId: apps.ownerId })
					.from(apps)
					.where(eq(apps.id, appId))
					.limit(1);
				if (!app || isFirstPartyApp(app, env.FIRST_PARTY_APP_IDS, env.ADMIN_USER_IDS)) return null;
				return app.name;
			},
			send: (to, mail) => sendHtmlMail(env, env.SIGNIN_FROM || DEFAULT_FROM, to, mail),
			log: (message, fields) => c.get("logger")?.warn(message, fields),
		},
	);
	return c.json(answer.body, answer.status);
});
