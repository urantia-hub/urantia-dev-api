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

// Why a token of an app with these scopes cannot use this path, or null if it can.
export function appTokenProblem(path: string, scopes: readonly string[]): string | null {
	// These routes act for the account itself: they register an app, and they issue a code for any app.
	if (isAt(path, "/auth"))
		return "This route needs a sign-in on the accounts site. A token of an app cannot use it.";
	if (!isAt(path, "/me")) return null;

	const scope =
		path === "/me" || path === "/me/"
			? "profile"
			: ME_SCOPES.find(([prefix]) => isAt(path, prefix))?.[1];
	if (!scope) return "A token of an app cannot use this route.";
	return scopes.includes(scope) ? null : `This token does not have the "${scope}" scope.`;
}
