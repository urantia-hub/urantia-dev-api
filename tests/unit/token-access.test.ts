import { describe, expect, it } from "bun:test";
import {
	appTokenProblem,
	canIssueCode,
	firstPartyIds,
	isFirstPartyApp,
	liveTokenProblem,
} from "../../src/lib/token-access.ts";

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

// Any reader can register an app and pick its id. So an id alone must never make an app ours.
describe("isFirstPartyApp", () => {
	const ids = "urantiahub-app";
	const admins = "admin-1, admin-2";
	it("is true for a listed app that an admin owns", () => {
		expect(isFirstPartyApp({ id: "urantiahub-app", ownerId: "admin-1" }, ids, admins)).toBe(true);
	});
	it("is false for a listed id that another reader owns", () => {
		expect(isFirstPartyApp({ id: "urantiahub-app", ownerId: "reader-9" }, ids, admins)).toBe(false);
	});
	it("is false for a listed id with no owner", () => {
		expect(isFirstPartyApp({ id: "urantiahub-app", ownerId: null }, ids, admins)).toBe(false);
	});
	it("is false for an app of an admin that is not in the list", () => {
		expect(isFirstPartyApp({ id: "other", ownerId: "admin-1" }, ids, admins)).toBe(false);
	});
	it("is false when either setting is absent", () => {
		expect(isFirstPartyApp({ id: "urantiahub-app", ownerId: "admin-1" }, undefined, admins)).toBe(
			false,
		);
		expect(isFirstPartyApp({ id: "urantiahub-app", ownerId: "admin-1" }, ids, undefined)).toBe(
			false,
		);
	});
});

// An access token lives for a time after it is made. Each request of an app checks what is true now.
describe("liveTokenProblem", () => {
	const app = { status: "approved" as const, ownerId: "owner-1" };
	const base = { app, consented: ["profile", "notes"], userId: "reader-1", scopes: ["profile"] };

	it("is null for an open app that the reader still allows", () => {
		expect(liveTokenProblem(base)).toBeNull();
	});

	it("answers 403 for an app that is gone, suspended, or in review for another reader", () => {
		expect(liveTokenProblem({ ...base, app: null })?.status).toBe(403);
		expect(liveTokenProblem({ ...base, app: { ...app, status: "suspended" } })?.status).toBe(403);
		expect(liveTokenProblem({ ...base, app: { ...app, status: "pending" } })?.status).toBe(403);
	});

	it("lets the owner use an app in review", () => {
		expect(
			liveTokenProblem({ ...base, app: { ...app, status: "pending" }, userId: "owner-1" }),
		).toBeNull();
	});

	// "Remove" on the account page must be true at once, not when the token ends.
	it("answers 401 when the reader removed the app, so the app signs the reader out", () => {
		expect(liveTokenProblem({ ...base, consented: null })).toEqual({
			status: 401,
			detail: "The reader removed the access of this app.",
		});
	});

	// Removed, then allowed again with less: the old token must not keep what the reader took back.
	it("answers 401 for a token with a permission that the reader does not allow now", () => {
		expect(liveTokenProblem({ ...base, scopes: ["profile", "bookmarks"] })?.status).toBe(401);
		expect(liveTokenProblem({ ...base, consented: [] })?.status).toBe(401);
	});

	it("checks the app before the consent, so a closed app says that it is closed", () => {
		expect(liveTokenProblem({ ...base, app: null, consented: null })?.status).toBe(403);
	});
});
