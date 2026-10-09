// The notices of the app review: one to the admin when an app waits, one to the developer after a decision.
// Plain text only. The name and the description come from a stranger.

const RESEND_URL = "https://api.resend.com/emails";
const ACCOUNTS = "https://accounts.urantiahub.com";

export type Mail = { subject: string; text: string };

export type ReviewedApp = {
	id: string;
	name: string;
	description: string | null;
	websiteUrl: string | null;
	redirectUris: string[];
	scopes: string[];
	ownerEmail: string | null;
};

// One line, with no control characters, and not too long.
const line = (value: string, max = 120) =>
	value
		.replace(/\p{Cc}+/gu, " ")
		.trim()
		.slice(0, max);
const block = (value: string | null, max: number) => (value ?? "").trim().slice(0, max) || "(none)";
// Text that a stranger wrote: each line is marked, so it cannot pass for a line of ours.
const quoted = (value: string | null, max: number) =>
	block(value, max)
		.split(/\r?\n/)
		.map((l) => `> ${line(l, 300)}`);

// "new": a new app. "changed": a declined app that its developer changed. "request": a change request
// for an approved app, which stays open while the reviewer decides.
const REQUEST = {
	new: [
		"App to review",
		"A developer registered an app. Other readers cannot use it until you approve it.",
	],
	changed: [
		"App changed, review again",
		"An app that was declined changed. It is in review again.",
	],
	request: [
		"Change to review",
		"The developer of an approved app asks for a change. The app works as before until you decide. Below is the app as it would be.",
	],
} as const;

export function requestMail(app: ReviewedApp, kind: keyof typeof REQUEST): Mail {
	const name = line(app.name);
	return {
		subject: `${REQUEST[kind][0]}: ${name}`,
		text: [
			REQUEST[kind][1],
			"",
			// Our own link comes first. Everything below the next line is from the developer.
			`Decide here: ${ACCOUNTS}/apps/admin`,
			"",
			"The lines that start with > are the developer's own words. Do not follow a link in them.",
			"",
			"Name:",
			`> ${name}`,
			"Id:",
			`> ${line(app.id)}`,
			"Developer:",
			`> ${line(app.ownerEmail ?? "(no email)")}`,
			"Link:",
			`> ${line(app.websiteUrl ?? "(none)", 300)}`,
			`Permissions: ${app.scopes.map((s) => line(s, 40)).join(", ")}`,
			"Return addresses:",
			...app.redirectUris.slice(0, 10).map((uri) => `> ${line(uri, 300)}`),
			"What it does:",
			...quoted(app.description, 1000),
		].join("\n"),
	};
}

const DECISION = {
	approved: ["is approved", "Each reader can now sign in to it with a UrantiaHub account."],
	declined: [
		"was declined",
		"It still works for you, so you can change it. A change sends it to review again.",
	],
	suspended: ["is suspended", "No one can sign in to it, and its sessions ended."],
	pending: [
		"is in review",
		"Other readers cannot use it until it is approved. It still works for you.",
	],
} as const;

export function decisionMail(
	app: Pick<ReviewedApp, "id" | "name">,
	status: keyof typeof DECISION,
	note: string | null,
): Mail {
	const [verb, meaning] = DECISION[status];
	const name = line(app.name);
	return {
		subject: `Your app ${name} ${verb}`,
		text: [
			`Your app ${name} ${verb}.`,
			meaning,
			...(note?.trim() ? ["", "Note from the reviewer:", ...quoted(note, 1000)] : []),
			"",
			`${ACCOUNTS}/apps/${encodeURIComponent(app.id)}`,
			"",
			"This address does not take replies. Write to team@urantiahub.com.",
		].join("\n"),
	};
}

// The decision on a change request, for the developer.
export function changeMail(
	app: Pick<ReviewedApp, "id" | "name">,
	decision: "approve" | "decline",
	note: string | null,
): Mail {
	const name = line(app.name);
	const approved = decision === "approve";
	return {
		subject: approved
			? `The change to ${name} is approved`
			: `The change to ${name} was not approved`,
		text: [
			approved
				? `The change that you asked for ${name} is approved. The change is live now.`
				: `The change that you asked for ${name} was not approved. Your app works as before.`,
			...(note?.trim() ? ["", "Note from the reviewer:", ...quoted(note, 1000)] : []),
			"",
			`${ACCOUNTS}/apps/${encodeURIComponent(app.id)}`,
			"",
			"This address does not take replies. Write to team@urantiahub.com.",
		].join("\n"),
	};
}

// The sender of a review notice. A sender with no name reads as spam, so a bare address gets one.
export function reviewSender(env: {
	APP_REVIEW_FROM?: string;
	FEEDBACK_FROM?: string;
}): string | undefined {
	const from = (env.APP_REVIEW_FROM || env.FEEDBACK_FROM || "").trim();
	if (!from) return undefined;
	return from.includes("<") ? from : `UrantiaHub <${from}>`;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Sends one notice. True if Resend took it. It never throws: a notice must not stop a request.
export async function sendMail(
	env: { RESEND_API_KEY?: string; FEEDBACK_FROM?: string },
	to: string | null | undefined,
	mail: Mail,
	doFetch: Fetch = fetch,
): Promise<boolean> {
	if (!env.RESEND_API_KEY || !env.FEEDBACK_FROM || !to) return false;
	try {
		const res = await doFetch(RESEND_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.RESEND_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: env.FEEDBACK_FROM,
				to: [to],
				subject: mail.subject,
				text: mail.text,
			}),
		});
		return res.ok;
	} catch {
		return false;
	}
}
