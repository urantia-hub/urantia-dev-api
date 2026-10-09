import { esc, FINE, frame, type HtmlMail, P } from "./layout.ts";

// The sign-in email: a 6-digit code, and a link that does the same.

const CALLBACK = "https://accounts.urantiahub.com/callback";

// Our own callback, or null. "redirect_to" comes with the request for the email, so it is checked:
// the proof of the sign-in must never go to another site.
function ownCallback(redirectTo: string | undefined): URL | null {
	try {
		const url = new URL(redirectTo ?? "");
		return url.origin + url.pathname === CALLBACK ? url : null;
	} catch {
		return null;
	}
}

// The parts of a sign-in request. Only these go from "redirect_to" into the link.
const REQUEST_PARTS = ["app_id", "redirect_uri", "scope", "code_challenge", "state", "redirect_to"];
const LINK_PAGE = "https://accounts.urantiahub.com/login/link";

// The link in the email. It opens a page of the accounts site with a "Sign in" button, and that page
// checks the proof. So a mail scanner that opens each link does not use the proof up, and the link
// works on any device. It keeps the request of the app, so the reader lands where the sign-in started.
// The link names the account that it signs in. The page shows that name before the press, and
// refuses a proof that is for another account: so a link that another person sent cannot sign a
// reader in to that person's account without the page saying so.
export function signInLink(
	redirectTo: string | undefined,
	tokenHash: string,
	email: string,
): string {
	const link = new URL(LINK_PAGE);
	link.searchParams.set("token_hash", tokenHash);
	link.searchParams.set("email", email.trim().toLowerCase());
	const from = ownCallback(redirectTo);
	for (const part of REQUEST_PARTS) {
		const value = from?.searchParams.get(part);
		if (value) link.searchParams.set(part, value);
	}
	return link.toString();
}

// The id of the app that the reader signs in to, or null for UrantiaHub's own sign-in.
export function requestOf(redirectTo: string | undefined): string | null {
	return ownCallback(redirectTo)?.searchParams.get("app_id") || null;
}

// "appName": the name of another app, or null for UrantiaHub itself and for an app that is not known.
export function signInMail(input: {
	code: string;
	link: string;
	appName: string | null;
}): HtmlMail {
	// Only six digits go into the subject.
	if (!/^\d{6}$/.test(input.code)) throw new Error("sign-in mail: the code is not six digits");
	const asked = input.appName ? `You asked to sign in to ${input.appName}. ` : "";
	const askedHtml = input.appName ? `You asked to sign in to <b>${esc(input.appName)}</b>. ` : "";
	const ignore = "If you did not ask for this, you can ignore this email.";
	return {
		subject: `${input.code} is your UrantiaHub code`,
		html: frame(
			"Your sign-in code",
			`<p style="margin:0 0 14px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:30px;letter-spacing:6px;font-weight:600;color:#26221c;background-color:#fbf8f2;border-radius:10px;padding:14px 18px;text-align:center;">${input.code}</p>
<p style="${P}">Enter this code on the sign-in page. It works for 10 minutes.</p>
<p style="${P}"><a href="${esc(input.link)}" style="color:#4f46e5;">Or sign in with this link</a></p>
<p style="${FINE}">${askedHtml}${ignore}</p>`,
		),
		text: [
			`Your sign-in code: ${input.code}`,
			"",
			"Enter this code on the sign-in page. It works for 10 minutes.",
			"",
			"Or sign in with this link:",
			input.link,
			"",
			`${asked}${ignore}`,
			"",
			"This address does not take replies. Write to team@urantiahub.com.",
		].join("\n"),
	};
}

// The name that the email gives for the app, or null for no name. Anyone can register an app, give
// it any name, and ask for a sign-in email to any address. So the email names an app only after a
// reviewer approved that name, and never an app of ours (UrantiaHub's own sign-in has no such line).
export function nameForMail(
	app: { name: string; status: string } | undefined,
	firstParty: boolean,
): string | null {
	if (!app || firstParty || app.status !== "approved") return null;
	return (
		app.name
			.replace(/\p{Cc}+/gu, " ")
			.trim()
			.slice(0, 100) || null
	);
}
