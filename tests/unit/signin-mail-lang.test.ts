import { describe, expect, it } from "bun:test";
import { signInMail } from "../../src/lib/mail/signin.ts";

const LINK = "https://accounts.urantiahub.com/login/link?token_hash=abc";

// The English email stays byte for byte when no language comes: other apps sign in here too.
describe("the English sign-in email", () => {
	it("is as before, with and without the name of an app", () => {
		expect(signInMail({ code: "481920", link: LINK, appName: null })).toMatchSnapshot();
		expect(
			signInMail({ code: "481920", link: LINK, appName: "Our Paper Voices" }),
		).toMatchSnapshot();
	});
});

describe("the language of the email", () => {
	const callback = (query: string) =>
		`https://accounts.urantiahub.com/callback?app_id=urantiahub-app${query}`;

	it("is Spanish only for es or es-*, from our own callback", async () => {
		const { mailLang } = await import("../../src/lib/mail/signin.ts");
		expect(mailLang(undefined)).toBe("en");
		expect(mailLang(callback(""))).toBe("en");
		expect(mailLang(callback("&ui_locales=es"))).toBe("es");
		expect(mailLang(callback("&ui_locales=es-MX"))).toBe("es");
		expect(mailLang(callback("&ui_locales=fr"))).toBe("en");
		expect(mailLang(callback("&ui_locales=<script>"))).toBe("en");
		expect(mailLang("https://evil.example/callback?ui_locales=es")).toBe("en");
	});

	it("goes on with the link, so the page of the link speaks it too", async () => {
		const { signInLink } = await import("../../src/lib/mail/signin.ts");
		expect(
			new URL(signInLink(callback("&ui_locales=es"), "h1")).searchParams.get("ui_locales"),
		).toBe("es");
	});
});

describe("the Spanish sign-in email", () => {
	const mail = signInMail({ code: "481920", link: LINK, appName: "Our Paper Voices", lang: "es" });

	it("is Spanish: the subject, the heading, the button, the lines, and the frame", () => {
		expect(mail.subject).toBe("481920 es tu código de UrantiaHub");
		expect(mail.html).toContain('<html lang="es">');
		expect(mail.html).toContain("Tu código para iniciar sesión");
		expect(mail.html).toMatch(/>Iniciar sesión<\/a>/);
		expect(mail.html).toContain("Pediste iniciar sesión en <b>Our Paper Voices</b>.");
		for (const part of [mail.html, mail.text]) {
			expect(part).toContain("481920");
			expect(part).toContain("Sirve durante 10 minutos.");
			expect(part).toContain("en el mismo navegador donde empezaste");
			expect(part).toContain("Si no lo pediste, puedes ignorar este correo.");
			expect(part).toContain("Esta dirección no recibe respuestas. Escribe a hi@urantiahub.com.");
			expect(part).not.toMatch(/sign in|Your |ignore this email/i);
		}
	});
});
