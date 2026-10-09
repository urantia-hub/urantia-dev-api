// An admin approves each app before other readers can use it.
// Any reader can register an app, so without this an app is trusted on its own word.

export const APP_STATUSES = ["pending", "approved", "declined", "suspended"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const isAppStatus = (value: unknown): value is AppStatus =>
	typeof value === "string" && (APP_STATUSES as readonly string[]).includes(value);

// Can this reader sign in through this app, or get a new token for it?
// pending, declined: the owner only, so a developer can build and test before the review.
// suspended: no one.
export function canUseApp(
	app: { status: AppStatus; ownerId: string | null },
	userId: string,
): boolean {
	if (app.status === "approved") return true;
	if (app.status === "pending" || app.status === "declined") {
		return app.ownerId !== null && app.ownerId === userId;
	}
	return false;
}

// The link to the app that its developer gives. An admin reads it as text, so the host that a browser
// would open must be the host that the text shows: https, plain letters, no name before an @, no
// backslash, no other script, and nothing that a browser reads in another way than a person does.
export function isWebLink(value: string): boolean {
	if (!/^https:\/\/[a-z0-9.-]+(:\d{1,5})?(\/[\x21-\x7e]*)?$/i.test(value)) return false;
	if (value.includes("\\") || value.includes("@")) return false;
	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase();
		return (
			url.protocol === "https:" &&
			url.username === "" &&
			url.password === "" &&
			host.includes(".") &&
			/[a-z]/.test(host) &&
			!host.split(".").some((label) => label.startsWith("xn--") || label === "")
		);
	} catch {
		return false;
	}
}

// Each new app sends an email to each admin. One reader cannot have more than this many in review.
export const MAX_PENDING_APPS = 3;
export const canRegisterAnother = (pendingAppsOfReader: number): boolean =>
	pendingAppsOfReader < MAX_PENDING_APPS;
