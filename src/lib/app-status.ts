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

type Reviewed = { name: string; logoUrl: string | null; redirectUris: readonly string[] };

// Did the edit change what the admin approved? The name and the logo are what a reader sees on the
// sign-in screen, and a return address is where a reader is sent. A removed address needs no review.
export function needsReview(before: Reviewed, after: Reviewed): boolean {
	if (before.name !== after.name || before.logoUrl !== after.logoUrl) return true;
	return after.redirectUris.some((uri) => !before.redirectUris.includes(uri));
}

// The status of an app after an edit by its owner or by an admin.
export function statusAfterEdit(
	status: AppStatus,
	editNeedsReview: boolean,
	byAdmin: boolean,
): AppStatus {
	// Only the status route lifts a suspension.
	if (status === "suspended") return "suspended";
	if (!editNeedsReview || byAdmin) return status;
	return "pending";
}
