// What a token of an app can reach. A session token of the accounts site is not limited here:
// it is the reader, signed in on the accounts site itself.

// The scope that each part of /me needs. A new part of /me has no scope until it is listed here,
// and a token of an app cannot reach it.
const ME_SCOPES: Array<[prefix: string, scope: string]> = [
	["/me/bookmarks", "bookmarks"],
	["/me/notes", "notes"],
	["/me/reading-progress", "reading-progress"],
	["/me/preferences", "preferences"],
];

const isAt = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

// Why a token of an app with these scopes cannot make this request, or null if it can.
// Call it only for a path that needs a sign-in. On any other path a token of an app is not a sign-in at all.
export function appTokenProblem(
	path: string,
	scopes: readonly string[],
	method = "GET",
): string | null {
	// These routes act for the account itself: they register an app, and they issue a code for any app.
	if (isAt(path, "/auth"))
		return "This route needs a sign-in on the accounts site. A token of an app cannot use it.";
	if (!isAt(path, "/me")) return null;

	if (path === "/me" || path === "/me/") {
		// The "profile" scope reads the profile. No scope of an app changes it.
		if (method !== "GET" && method !== "HEAD")
			return "A token of an app cannot change the profile.";
		return scopes.includes("profile") ? null : 'This token does not have the "profile" scope.';
	}

	const scope = ME_SCOPES.find(([prefix]) => isAt(path, prefix))?.[1];
	if (!scope) return "A token of an app cannot use this route.";
	return scopes.includes(scope) ? null : `This token does not have the "${scope}" scope.`;
}

// The apps that are ours. A reader does not see the consent screen for them.
export function firstPartyIds(setting: string | undefined): string[] {
	return (setting ?? "")
		.split(",")
		.map((id) => id.trim())
		.filter(Boolean);
}

// Can the accounts site issue a code for these scopes now?
// "grant" is true only when the reader pressed Allow on the consent screen.
export function canIssueCode(input: {
	requested: readonly string[];
	consented: readonly string[];
	firstParty: boolean;
	grant: boolean;
}): boolean {
	if (input.firstParty || input.grant) return true;
	return input.requested.every((scope) => input.consented.includes(scope));
}
