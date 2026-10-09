// The notices of the app review: one to the admin when an app waits, one to the developer after a decision.
// Each has an HTML part and a text part. The name and the description come from a stranger: they are
// shown as text, marked as theirs, and the only link in a notice is ours.

import { esc, FINE, frame, P } from "./mail/layout.ts";

const RESEND_URL = "https://api.resend.com/emails";
const ACCOUNTS = "https://accounts.urantiahub.com";

export type Mail = { subject: string; text: string; html?: string };
type Notice = Required<Mail>;

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

const QUOTE =
	"margin:0 0 13px;padding:10px 14px;border-left:3px solid #e7e0d2;background-color:#fdfbf6;color:#4a463f;border-radius:0 8px 8px 0;font-size:14.5px;line-height:1.5;";
const para = (text: string) => `<p style="${P}">${esc(text)}</p>`;
const fine = (text: string) => `<p style="${FINE}">${esc(text)}</p>`;
// The words of another person, as text. A new line stays a new line.
const quote = (lines: string[]) =>
	`<blockquote style="${QUOTE}">${lines.map((l) => esc(l)).join("<br>")}</blockquote>`;
// The one link of a notice: ours.
const button = (label: string, href: string) =>
	`<p style="${P}"><a href="${esc(href)}" style="display:inline-block;background-color:#26221c;color:#ffffff;text-decoration:none;border-radius:10px;padding:11px 18px;font-weight:500;font-size:14.5px;">${esc(label)}</a></p>`;
const noteLines = (note: string | null) =>
	block(note, 1000)
		.split(/\r?\n/)
		.map((l) => line(l, 300));

const NO_REPLY = "This address does not take replies. Write to team@urantiahub.com.";
const appPage = (id: string) => `${ACCOUNTS}/apps/${encodeURIComponent(id)}`;

// "new": a new app. "changed": a declined app that its developer changed. "request": a change request
// for an approved app, which stays open while the reviewer decides.
const REQUEST = {
	new: [
		"App to review",
		"A new app waits for you",
		"A developer registered an app. Other people cannot use it until you approve it.",
	],
	changed: [
		"App changed, review again",
		"An app changed, and waits for you",
		"An app that was declined changed. It is in review again.",
	],
	request: [
		"Change to review",
		"A change waits for you",
		"The developer of an approved app asks for a change. The app works as before until you decide. Below is the app as it would be.",
	],
} as const;

// To an admin: an app, or a change, waits for a review.
export function requestMail(app: ReviewedApp, kind: keyof typeof REQUEST): Notice {
	const name = line(app.name);
	const [subject, heading, lead] = REQUEST[kind];
	const review = `${ACCOUNTS}/apps/admin/${encodeURIComponent(app.id)}`;
	const warning = "Below are the developer's own words. Do not follow a link in them.";
	const permissions = app.scopes.map((s) => line(s, 40)).join(", ");
	const uris = app.redirectUris.slice(0, 10).map((uri) => line(uri, 300));
	const description = block(app.description, 1000)
		.split(/\r?\n/)
		.map((l) => line(l, 300));
	return {
		subject: `${subject}: ${name}`,
		text: [
			lead,
			"",
			// Our own link comes first. Everything below the next line is from the developer.
			`Review it: ${review}`,
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
			`Permissions: ${permissions}`,
			"Return addresses:",
			...uris.map((uri) => `> ${uri}`),
			"What it does:",
			...quoted(app.description, 1000),
			"",
			NO_REPLY,
		].join("\n"),
		html: frame(
			heading,
			[
				para(lead),
				button("Review it", review),
				fine(warning),
				quote([
					`${name} · ${line(app.id)}`,
					line(app.ownerEmail ?? "(no email)"),
					"",
					...description,
					"",
					`Link: ${line(app.websiteUrl ?? "(none)", 300)}`,
					...uris.map((uri) => `Return address: ${uri}`),
					`Permissions: ${permissions}`,
				]),
			].join("\n"),
		),
	};
}

// To the developer: the decision of a reviewer on the app.
export function decisionMail(
	app: Pick<ReviewedApp, "id" | "name">,
	status: "approved" | "declined" | "suspended" | "pending",
	note: string | null,
): Notice {
	const name = line(app.name);
	const page = appPage(app.id);
	const hasNote = !!note?.trim();
	const notes = noteLines(note);
	const quotedNote = hasNote ? quoted(note, 1000) : [];

	if (status === "approved") {
		const lead =
			"Each person can now sign in to your app with a UrantiaHub account. Thank you for building with the Papers.";
		const later =
			"A later change to the name, the logo, a return address, or a permission goes to a reviewer first. The app keeps working in the meantime.";
		return {
			subject: `${name} is approved`,
			text: [
				lead,
				...(hasNote ? ["", "Note from the reviewer:", ...quotedNote] : []),
				"",
				`Open the app page: ${page}`,
				"",
				later,
				"",
				NO_REPLY,
			].join("\n"),
			html: frame(
				`${name} is approved`,
				[
					para(lead),
					...(hasNote ? [quote(notes)] : []),
					button("Open the app page", page),
					fine(later),
				].join("\n"),
			),
		};
	}

	if (status === "declined") {
		const lead = "A reviewer looked at your app and asks for a change first:";
		const next =
			"The app still works for you, so you can keep building. When you change it, it goes to review again by itself.";
		const help = "Questions? Write to team@urantiahub.com. A person reads it.";
		return {
			subject: `${name} needs a change before it can open`,
			text: [
				`${name} is not approved yet.`,
				"",
				lead,
				...quotedNote,
				"",
				next,
				"",
				`Open the app page: ${page}`,
				"",
				help,
			].join("\n"),
			html: frame(
				`${name} is not approved yet`,
				[para(lead), quote(notes), para(next), button("Open the app page", page), fine(help)].join(
					"\n",
				),
			),
		};
	}

	if (status === "suspended") {
		const lead = `We are sorry to send this. From now on no one can sign in to ${name} with a UrantiaHub account, and the people who were signed in are signed out.`;
		const todo =
			"What you can do. If this is a mistake, or when the problem is fixed, write to team@urantiahub.com. A person reads it and answers. A suspension can be lifted, and your app and its settings are kept.";
		const kept = "Nothing was deleted. The data of your users in your own systems is not touched.";
		return {
			subject: `${name} is suspended`,
			text: [
				`We suspended ${name}.`,
				"",
				lead,
				"",
				"The reason:",
				...quotedNote,
				"",
				todo,
				"",
				kept,
			].join("\n"),
			html: frame(
				`We suspended ${name}`,
				[para(lead), para("The reason:"), quote(notes), para(todo), fine(kept)].join("\n"),
			),
		};
	}

	const lead =
		"Other people cannot sign in to it until a reviewer approves it. It still works for you.";
	return {
		subject: `${name} is in review again`,
		text: [
			`${name} is in review again.`,
			lead,
			...(hasNote ? ["", "Note from the reviewer:", ...quotedNote] : []),
			"",
			`Open the app page: ${page}`,
			"",
			NO_REPLY,
		].join("\n"),
		html: frame(
			`${name} is in review again`,
			[para(lead), ...(hasNote ? [quote(notes)] : []), button("Open the app page", page)].join(
				"\n",
			),
		),
	};
}

// To the developer: the decision of a reviewer on a change request.
export function changeMail(
	app: Pick<ReviewedApp, "id" | "name">,
	decision: "approve" | "decline",
	note: string | null,
): Notice {
	const name = line(app.name);
	const page = appPage(app.id);
	const hasNote = !!note?.trim();
	if (decision === "approve") {
		const lead = `The change that you asked for ${name} is approved. The change is live now.`;
		return {
			subject: `The change to ${name} is approved`,
			text: [
				lead,
				...(hasNote ? ["", "Note from the reviewer:", ...quoted(note, 1000)] : []),
				"",
				`Open the app page: ${page}`,
				"",
				NO_REPLY,
			].join("\n"),
			html: frame(
				`The change to ${name} is approved`,
				[
					para(lead),
					...(hasNote ? [quote(noteLines(note))] : []),
					button("Open the app page", page),
				].join("\n"),
			),
		};
	}
	const lead = `A reviewer looked at the change that you asked for ${name} and did not approve it:`;
	const next = "Your app works as before. You can ask for another change at any time.";
	return {
		subject: `The change to ${name} was not approved`,
		text: [
			lead,
			...quoted(note, 1000),
			"",
			next,
			"",
			`Open the app page: ${page}`,
			"",
			NO_REPLY,
		].join("\n"),
		html: frame(
			`The change to ${name} was not approved`,
			[para(lead), quote(noteLines(note)), para(next), button("Open the app page", page)].join(
				"\n",
			),
		),
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
				...(mail.html ? { html: mail.html } : {}),
			}),
		});
		return res.ok;
	} catch {
		return false;
	}
}
