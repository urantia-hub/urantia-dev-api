// The check of a signed webhook, by the Standard Webhooks rules. Supabase signs its auth hooks so.
// https://www.standardwebhooks.com

const TOLERANCE_SECONDS = 5 * 60;

function fromBase64(value: string): Uint8Array | null {
	try {
		return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
	} catch {
		return null;
	}
}

// Compares in the same time for each input of the same length.
function same(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
	return diff === 0;
}

// Is this request from the holder of the secret, and made now? The body is the text as it arrived.
export async function verifyWebhook(
	secret: string | undefined,
	header: (name: string) => string | undefined,
	body: string,
	now: Date = new Date(),
): Promise<boolean> {
	// The secret is "v1,whsec_<base64>". The key is the part after the prefix.
	const key = fromBase64(
		(secret ?? "")
			.trim()
			.replace(/^v1,/, "")
			.replace(/^whsec_/, ""),
	);
	const id = header("webhook-id");
	const timestamp = header("webhook-timestamp");
	const signatures = header("webhook-signature");
	if (!key || key.length === 0 || !id || !timestamp || !signatures) return false;

	// A request that someone recorded must not work later.
	if (!/^\d{1,12}$/.test(timestamp)) return false;
	if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > TOLERANCE_SECONDS) return false;

	const hmac = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
		"sign",
	]);
	const expected = new Uint8Array(
		await crypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
	);
	// The header can hold more than one signature, each as "v1,<base64>".
	return signatures.split(" ").some((entry) => {
		const [version, value] = entry.split(",");
		const given = version === "v1" && value ? fromBase64(value) : null;
		return given !== null && same(given, expected);
	});
}
