// The two calls that need the service key of Supabase: does this sign-in exist, and remove it.
// The key never goes into a log or an error.

export type AdminSettings = { url: string; key: string };

export function adminSettings(env: {
	SUPABASE_URL?: string;
	SUPABASE_SERVICE_ROLE_KEY?: string;
}): AdminSettings | null {
	const url = env.SUPABASE_URL?.trim().replace(/\/+$/, "");
	const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
	return url && key ? { url, key } : null;
}

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(
	settings: AdminSettings,
	method: "GET" | "DELETE",
	userId: string,
	fetcher: typeof fetch,
): Promise<number> {
	if (!USER_ID.test(userId)) throw new Error("supabase admin: not a user id");
	const res = await fetcher(`${settings.url}/auth/v1/admin/users/${userId}`, {
		method,
		headers: { Authorization: `Bearer ${settings.key}`, apikey: settings.key },
	});
	return res.status;
}

// Removes the sign-in itself. A user that is gone already counts as done, so a delete can run again.
export async function removeSignIn(
	settings: AdminSettings,
	userId: string,
	fetcher: typeof fetch = fetch,
): Promise<void> {
	const status = await call(settings, "DELETE", userId, fetcher);
	if (status === 404 || (status >= 200 && status < 300)) return;
	throw new Error(`supabase admin: delete answered ${status}`);
}

// Does Supabase still know this user? A session token stays good for a time after a delete.
export async function signInExists(
	settings: AdminSettings,
	userId: string,
	fetcher: typeof fetch = fetch,
): Promise<boolean> {
	const status = await call(settings, "GET", userId, fetcher);
	if (status === 404) return false;
	if (status >= 200 && status < 300) return true;
	throw new Error(`supabase admin: lookup answered ${status}`);
}
