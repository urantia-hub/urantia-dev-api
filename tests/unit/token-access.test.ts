import { describe, expect, it } from "bun:test";
import { appTokenProblem, canIssueCode, firstPartyIds } from "../../src/lib/token-access.ts";

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

	// The "profile" scope reads the profile. No scope of an app changes it.
	it("lets the profile scope read the profile, and not change it", () => {
		expect(appTokenProblem("/me", ["profile"], "GET")).toBeNull();
		expect(appTokenProblem("/me", ["profile"], "PUT")).not.toBeNull();
		expect(appTokenProblem("/me", ["profile"], "DELETE")).not.toBeNull();
		expect(appTokenProblem("/me/bookmarks", ["bookmarks"], "POST")).toBeNull();
	});
});

describe("canIssueCode", () => {
	const base = {
		requested: ["profile", "notes"],
		consented: ["profile"],
		firstParty: false,
		grant: false,
	};
	it("refuses a new permission with no press on Allow", () =>
		expect(canIssueCode(base)).toBe(false));
	it("allows it after a press on Allow", () =>
		expect(canIssueCode({ ...base, grant: true })).toBe(true));
	it("allows what the reader already allowed", () =>
		expect(canIssueCode({ ...base, requested: ["profile"] })).toBe(true));
	it("allows a first-party app", () =>
		expect(canIssueCode({ ...base, firstParty: true })).toBe(true));
	it("refuses a reader with no consent at all", () =>
		expect(canIssueCode({ ...base, consented: [] })).toBe(false));
});

describe("firstPartyIds", () => {
	it("reads a list, and ignores spaces and empty items", () => {
		expect(firstPartyIds(" urantiahub-app, ,demo ")).toEqual(["urantiahub-app", "demo"]);
	});
	it("is empty with no setting, so no app skips the consent screen by default", () => {
		expect(firstPartyIds(undefined)).toEqual([]);
	});
});
