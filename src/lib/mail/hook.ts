import { verifyWebhook } from "../webhook.ts";
import type { HtmlMail } from "./layout.ts";
import { requestOf, signInLink, signInMail } from "./signin.ts";

// The "Send Email" hook of Supabase Auth: Supabase calls it for each auth email, and this code writes
// and sends the email. With the hook on, Supabase sends nothing by itself.

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Sends one email with an HTML part and a text part. True if Resend took it. It never throws.
// "report" gets the reason for a failure: the status of the mail service, never its words, which can
// hold an address.
export async function sendHtmlMail(
	env: { RESEND_API_KEY?: string },
	from: string,
	to: string,
	mail: HtmlMail,
	doFetch: Fetch = fetch,
	report: (reason: string) => void = () => {},
): Promise<boolean> {
	if (!env.RESEND_API_KEY) {
		report("no key");
		return false;
	}
	try {
		const res = await doFetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from,
				to: [to],
				subject: mail.subject,
				html: mail.html,
				text: mail.text,
			}),
		});
		if (!res.ok) report(`status ${res.status}`);
		return res.ok;
	} catch {
		report("network");
		return false;
	}
}

export type HookDeps = {
	secret: string | undefined;
	// The name of another app, or null for an app of ours and for one that is not known.
	appName: (appId: string) => Promise<string | null>;
	send: (to: string, mail: HtmlMail) => Promise<boolean>;
	// A log line. It must never get an email address, a code, or a proof.
	log: (message: string, fields?: Record<string, unknown>) => void;
	now?: Date;
};

type HookAnswer = { status: 200 | 400 | 401 | 500; body: Record<string, unknown> };

// The form of an error that Supabase reads.
const failed = (status: 400 | 401 | 500, message: string): HookAnswer => ({
	status,
	body: { error: { http_code: status, message } },
});

// The kinds that the email code uses: a reader who signs in, and a new reader.
const SIGN_IN_KINDS = new Set(["magiclink", "signup"]);

export async function handleSendEmail(
	request: { body: string; header: (name: string) => string | undefined },
	deps: HookDeps,
): Promise<HookAnswer> {
	if (!(await verifyWebhook(deps.secret, request.header, request.body, deps.now))) {
		return failed(401, "The signature is not valid.");
	}

	let email: string | undefined;
	let data: Record<string, unknown> | undefined;
	try {
		const parsed = JSON.parse(request.body) as { user?: { email?: unknown }; email_data?: unknown };
		if (typeof parsed.user?.email === "string") email = parsed.user.email;
		if (parsed.email_data && typeof parsed.email_data === "object") {
			data = parsed.email_data as Record<string, unknown>;
		}
	} catch {
		// Handled below.
	}
	const kind = data?.email_action_type;
	const token = data?.token;
	const tokenHash = data?.token_hash;
	if (
		!email ||
		typeof kind !== "string" ||
		typeof token !== "string" ||
		typeof tokenHash !== "string"
	) {
		return failed(400, "The request is not a Send Email request.");
	}

	// We use the email code only. Any other kind is not sent, so no email goes out with words that do
	// not fit it. The log line is what an alert can watch.
	if (!SIGN_IN_KINDS.has(kind)) {
		deps.log("send-email hook: not sent", { kind: kind.slice(0, 40) });
		return { status: 200, body: {} };
	}

	const redirectTo = typeof data?.redirect_to === "string" ? data.redirect_to : undefined;
	try {
		const appId = requestOf(redirectTo);
		const mail = signInMail({
			code: token,
			link: signInLink(redirectTo, tokenHash),
			appName: appId ? await deps.appName(appId) : null,
		});
		if (await deps.send(email, mail)) return { status: 200, body: {} };
		deps.log("send-email hook: the email was not sent", { kind });
	} catch (error) {
		deps.log("send-email hook: failed", {
			kind,
			error: error instanceof Error ? error.name : "unknown",
		});
	}
	// Supabase tells the sign-in page that the email failed, and the reader can try again.
	return failed(500, "The email was not sent.");
}
