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

type Reviewed = {
	name: string;
	logoUrl: string | null;
	redirectUris: readonly string[];
	scopes: readonly string[];
};

// Did the edit change what the admin approved? The name and the logo are what a reader sees on the
// sign-in screen, a return address is where a reader is sent, and a permission is what the app can reach.
// A removed address or permission needs no review.
export function needsReview(before: Reviewed, after: Reviewed): boolean {
	if (before.name !== after.name || before.logoUrl !== after.logoUrl) return true;
	if (after.redirectUris.some((uri) => !before.redirectUris.includes(uri))) return true;
	return after.scopes.some((scope) => !before.scopes.includes(scope));
}

// What an edit does to the status. The route reads the app and then writes, and an admin can suspend
// the app between the two. So an edit never writes a status that it read. It names the statuses that
// move to pending, and the database applies that to the row as it is at that moment.
// An edit can never approve an app or lift a suspension.
export function reviewStatusChange(
	editNeedsReview: boolean,
	byAdmin: boolean,
): { from: AppStatus[]; to: "pending" } | null {
	if (!editNeedsReview || byAdmin) return null;
	return { from: ["approved", "declined"], to: "pending" };
}

// The link to the app that its developer gives. An admin presses it, so it is a web address and nothing else.
export function isWebLink(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname.includes(".");
	} catch {
		return false;
	}
}

// Each new app sends an email to each admin. One reader cannot have more than this many in review.
export const MAX_PENDING_APPS = 3;
export const canRegisterAnother = (pendingAppsOfReader: number): boolean =>
	pendingAppsOfReader < MAX_PENDING_APPS;
