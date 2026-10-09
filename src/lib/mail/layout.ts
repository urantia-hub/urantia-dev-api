// The frame of each email of UrantiaHub: the mark, the name, one card. Inline styles only, and no
// remote file: a mail program shows it as it is, and nothing tells us that a reader opened it.

export type HtmlMail = { subject: string; html: string; text: string };

// Text of a stranger, or of a reader, as text in HTML.
export const esc = (value: string): string =>
	value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export const P = `margin:0 0 13px;font-size:15px;line-height:1.55;color:#4a463f;`;
export const FINE = `margin:0 0 8px;font-size:12.5px;line-height:1.5;color:#8b8375;`;

// "inner" is HTML that the caller made, with each outside value passed through esc().
export function frame(title: string, inner: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;font-family:${FONT};" bgcolor="#fbf8f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#fbf8f2" style="padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="440" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="max-width:440px;border:1px solid #e7e0d2;border-radius:12px;">
<tr><td style="padding:24px 22px;">
<p style="margin:0 0 18px;font-family:${SERIF};font-size:17px;color:#26221c;">UrantiaHub</p>
<h1 style="margin:0 0 10px;font-family:${SERIF};font-weight:500;font-size:21px;line-height:1.3;color:#26221c;">${esc(title)}</h1>
${inner}
<p style="${FINE}margin-bottom:0;">This address does not take replies. Write to team@urantiahub.com.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
