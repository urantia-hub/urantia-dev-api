// The reader's side of the account: the apps that the reader allowed, the removal of one,
// and the delete of the whole account. The rules are here, over a store, so tests need no database.

// Each table that holds rows of a reader, in the order of a delete.
export const READER_TABLES = [
	"bookmarks",
	"notes",
	"reading_progress",
	"user_preferences",
	"app_user_data",
	"user_consents",
	"refresh_tokens",
	"auth_codes",
] as const;
export type ReaderTable = (typeof READER_TABLES)[number];

export type AccessRow = {
	appId: string;
	name: string;
	ownerId: string | null;
	logoUrl: string | null;
	primaryColor: string | null;
	scopes: string[];
	grantedAt: Date;
};

export interface AccountStore {
	// Each app that the reader allowed, with the app's public face.
	access(userId: string): Promise<AccessRow[]>;
	// The consent, the refresh tokens, and the waiting codes of one app for one reader.
	removeAccess(userId: string, appId: string): Promise<void>;
	// The apps that the reader registered. "otherUsers" counts the other readers who allowed the app.
	ownedApps(
		userId: string,
	): Promise<Array<{ id: string; name: string; status: string; otherUsers: number }>>;
	// Did a delete of this account start already?
	isMarked(userId: string): Promise<boolean>;
	// Records that this account is deleted. From that moment no token of the reader is a sign-in.
	markDeleted(userId: string): Promise<void>;
	deleteRows(table: ReaderTable, userId: string): Promise<void>;
	deleteApp(appId: string): Promise<void>;
	deleteUser(userId: string): Promise<void>;
}

// What the reader sees in "Other apps with access". An app of ours is not another app, so it is left out.
export async function listAccess(
	store: AccountStore,
	userId: string,
	isOurs: (app: { id: string; ownerId: string | null }) => boolean,
) {
	const rows = await store.access(userId);
	return rows
		.filter((row) => !isOurs({ id: row.appId, ownerId: row.ownerId }))
		.map((row) => ({
			appId: row.appId,
			name: row.name,
			logoUrl: row.logoUrl,
			primaryColor: row.primaryColor,
			scopes: row.scopes,
			grantedAt: row.grantedAt.toISOString(),
		}));
}

// The reader's own bookmarks and notes stay. They belong to the reader, not to the app.
export async function removeAccess(store: AccountStore, userId: string, appId: string) {
	await store.removeAccess(userId, appId);
}

export type DeleteResult =
	| { ok: true }
	// The typed email is not the reader's.
	| { ok: false; reason: "email" }
	// An admin reviews apps and owns the apps of UrantiaHub itself. That account is removed by hand.
	| { ok: false; reason: "admin" }
	// The reader owns an open app that other people use. A delete would sign them out with no warning.
	| { ok: false; reason: "apps"; apps: string[] };

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Deletes the account. Each step removes what is there and is safe to run again, so a delete that
// failed halfway finishes on the next try. The sign-in goes last: until then the reader can try again.
// The removal of the reader's row removes each row that still points at it, so nothing stays behind.
export async function deleteAccount(
	store: AccountStore,
	input: {
		userId: string;
		email: string | null;
		typedEmail: string;
		isAdmin?: boolean;
		removeSignIn: (userId: string) => Promise<void>;
	},
): Promise<DeleteResult> {
	if (!input.email || !same(input.email, input.typedEmail)) return { ok: false, reason: "email" };

	const owned = await store.ownedApps(input.userId);
	// A delete that started must be able to finish: after the marker, each other request of the reader
	// is refused, so a refusal here would leave the reader with no way on.
	if (!(await store.isMarked(input.userId))) {
		const inUse = owned.filter((app) => app.status === "approved" && app.otherUsers > 0);
		if (inUse.length > 0) return { ok: false, reason: "apps", apps: inUse.map((app) => app.name) };
		if (input.isAdmin) return { ok: false, reason: "admin" };
	}

	// The marker comes first and stays. A token that is still good cannot make the reader's row again,
	// and cannot add a row behind the delete.
	await store.markDeleted(input.userId);
	for (const table of READER_TABLES) await store.deleteRows(table, input.userId);
	for (const app of owned) await store.deleteApp(app.id);
	await store.deleteUser(input.userId);
	await input.removeSignIn(input.userId);
	return { ok: true };
}

// What a reader whose account is marked as deleted can still do: finish the delete, from the accounts
// site. Each other request is refused, with any token.
export function deletedAccountAllows(request: {
	method: string;
	path: string;
	fromApp: boolean;
}): boolean {
	return !request.fromApp && request.method === "DELETE" && request.path === "/auth/account";
}

// What the reader reads after a refused delete.
export function refusalText(result: Exclude<DeleteResult, { ok: true }>): string {
	if (result.reason === "email") return "The email does not match your account.";
	if (result.reason === "admin") {
		return "This account reviews apps for UrantiaHub, so it cannot be deleted here. Write to hi@urantiahub.com.";
	}
	return "You own an app that other people use. Delete your apps first, or write to hi@urantiahub.com.";
}
