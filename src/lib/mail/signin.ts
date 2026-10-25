import { BUTTON, esc, FINE, frame, type HtmlMail, type MailLang, NO_REPLY, P } from "./layout.ts";

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
const REQUEST_PARTS = [
	"app_id",
	"redirect_uri",
	"scope",
	"code_challenge",
	"state",
	"redirect_to",
	"ui_locales",
];
const LINK_PAGE = "https://accounts.urantiahub.com/login/link";

// The link in the email. It opens a page of the accounts site with a "Sign in" button, and that page
// checks the proof. So a mail scanner that opens each link does not use the proof up, and the link
// works on any device. It keeps the request of the app, so the reader lands where the sign-in started.
export function signInLink(redirectTo: string | undefined, tokenHash: string): string {
	const link = new URL(LINK_PAGE);
	link.searchParams.set("token_hash", tokenHash);
	const from = ownCallback(redirectTo);
	for (const part of REQUEST_PARTS) {
		const value = from?.searchParams.get(part);
		if (value) link.searchParams.set(part, value);
	}
	return link.toString();
}

// The language that the sign-in asked for (`ui_locales` of our own callback): Spanish for "es" or "es-*",
// English for any other value or none.
export function mailLang(redirectTo: string | undefined): MailLang {
	const asked = ownCallback(redirectTo)?.searchParams.get("ui_locales") ?? "";
	return /^es(-[A-Za-z0-9]{1,8})?$/.test(asked.split(" ")[0] ?? "") ? "es" : "en";
}

const WORDS = {
	en: {
		subject: (code: string) => `${code} is your UrantiaHub code`,
		title: "Your sign-in code",
		enter: "Enter this code on the sign-in page. It works for 10 minutes.",
		press: "Or press the button, in the same browser where you started.",
		button: "Sign in",
		asked: (app: string) => `You asked to sign in to ${app}. `,
		ignore: "If you did not ask for this, you can ignore this email.",
		textCode: (code: string) => `Your sign-in code: ${code}`,
		open: "Or open this link, in the same browser where you started:",
	},
	es: {
		subject: (code: string) => `${code} es tu código de UrantiaHub`,
		title: "Tu código para iniciar sesión",
		enter: "Escribe este código en la página para iniciar sesión. Sirve durante 10 minutos.",
		press: "O pulsa el botón, en el mismo navegador donde empezaste.",
		button: "Iniciar sesión",
		asked: (app: string) => `Pediste iniciar sesión en ${app}. `,
		ignore: "Si no lo pediste, puedes ignorar este correo.",
		textCode: (code: string) => `Tu código para iniciar sesión: ${code}`,
		open: "O abre este enlace, en el mismo navegador donde empezaste:",
	},
} satisfies Record<MailLang, unknown>;

// The id of the app that the reader signs in to, or null for UrantiaHub's own sign-in.
export function requestOf(redirectTo: string | undefined): string | null {
	return ownCallback(redirectTo)?.searchParams.get("app_id") || null;
}

// "appName": the name of another app, or null for UrantiaHub itself and for an app that is not known.
export function signInMail(input: {
	code: string;
	link: string;
	appName: string | null;
	lang?: MailLang;
}): HtmlMail {
	const lang = input.lang ?? "en";
	const w = WORDS[lang];
	// Only six digits go into the subject.
	if (!/^\d{6}$/.test(input.code)) throw new Error("sign-in mail: the code is not six digits");
	const asked = input.appName ? w.asked(input.appName) : "";
	const askedHtml = input.appName ? w.asked(`<b>${esc(input.appName)}</b>`) : "";
	const ignore = w.ignore;
	return {
		subject: w.subject(input.code),
		html: frame(
			w.title,
			`<p style="margin:0 0 14px;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:30px;letter-spacing:6px;font-weight:600;color:#26221c;background-color:#fbf8f2;border-radius:10px;padding:14px 18px;text-align:center;">${input.code}</p>
<p style="${P}">${w.enter}</p>
<p style="${P}">${w.press}</p>
<p style="margin:0 0 18px;"><a href="${esc(input.link)}" style="${BUTTON}">${w.button}</a></p>
<p style="${FINE}">${askedHtml}${ignore}</p>`,
			lang,
		),
		text: [
			w.textCode(input.code),
			"",
			w.enter,
			"",
			w.open,
			input.link,
			"",
			`${asked}${ignore}`,
			"",
			NO_REPLY[lang],
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
