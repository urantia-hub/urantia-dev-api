import { describe, expect, it } from "bun:test";
import { appTokenProblem } from "../../src/lib/token-access.ts";

describe("what a token of an app can reach", () => {
	it.each([
		["/me", "profile"],
		["/me/", "profile"],
		["/me/bookmarks", "bookmarks"],
		["/me/bookmarks/categories", "bookmarks"],
		["/me/bookmarks/1:0.1", "bookmarks"],
		["/me/notes/abc", "notes"],
		["/me/reading-progress", "reading-progress"],
		["/me/preferences", "preferences"],
	])("%s needs the scope %s", (path, scope) => {
		expect(appTokenProblem(path, [scope])).toBeNull();
		expect(appTokenProblem(path, ["app-data"])).toContain(`"${scope}"`);
		expect(appTokenProblem(path, [])).toContain(`"${scope}"`);
	});

	it("does not take one scope for another that starts with the same letters", () => {
		expect(appTokenProblem("/me/notes", ["note"])).not.toBeNull();
		expect(appTokenProblem("/me/notesx", ["notes"])).not.toBeNull();
	});

	it("refuses a path under /me that has no scope yet", () => {
		expect(
			appTokenProblem("/me/something-new", [
				"profile",
				"bookmarks",
				"notes",
				"reading-progress",
				"preferences",
				"app-data",
			]),
		).not.toBeNull();
	});

	// These routes act for the account itself: they register an app, and they issue a code for any app.
	it.each([
		"/auth/authorize",
		"/auth/apps",
		"/auth/consent",
		"/auth/apps/my-app/secret",
	])("refuses %s", (path) => {
		expect(
			appTokenProblem(path, [
				"profile",
				"bookmarks",
				"notes",
				"reading-progress",
				"preferences",
				"app-data",
			]),
		).not.toBeNull();
	});

	it("has no rule for a public path", () => {
		expect(appTokenProblem("/papers/1", [])).toBeNull();
		expect(appTokenProblem("/search", [])).toBeNull();
		expect(appTokenProblem("/meaning", [])).toBeNull();
	});
});
