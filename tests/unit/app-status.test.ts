import { describe, expect, it } from "bun:test";
import {
	type AppStatus,
	canRegisterAnother,
	canUseApp,
	isAppStatus,
	isWebLink,
	needsReview,
	reviewStatusChange,
} from "../../src/lib/app-status.ts";

const OWNER = "owner-1";
const app = (status: AppStatus) => ({ status, ownerId: OWNER });

describe("canUseApp", () => {
	it("lets each reader use an approved app", () => {
		expect(canUseApp(app("approved"), "someone")).toBe(true);
		expect(canUseApp(app("approved"), OWNER)).toBe(true);
	});

	// The developer builds and tests before the review. No other reader can be sent through the app.
	it.each(["pending", "declined"] as const)("lets only the owner use a %s app", (status) => {
		expect(canUseApp(app(status), OWNER)).toBe(true);
		expect(canUseApp(app(status), "someone")).toBe(false);
	});

	it("lets no one use a suspended app, also not its owner", () => {
		expect(canUseApp(app("suspended"), OWNER)).toBe(false);
		expect(canUseApp(app("suspended"), "someone")).toBe(false);
	});

	it("lets no one use a pending app that has no owner", () => {
		expect(canUseApp({ status: "pending", ownerId: null }, "someone")).toBe(false);
	});

	it("lets no one use an app with a status that is not known", () => {
		expect(canUseApp({ status: "open" as AppStatus, ownerId: OWNER }, OWNER)).toBe(false);
	});
});

describe("needsReview", () => {
	const before = {
		name: "My App",
		logoUrl: "https://x/logo.png",
		redirectUris: ["https://a/cb", "https://b/cb"],
		scopes: ["profile", "bookmarks"],
	};

	it("is false when nothing that a reader trusts changed", () => {
		expect(needsReview(before, { ...before })).toBe(false);
		expect(needsReview(before, { ...before, redirectUris: ["https://b/cb", "https://a/cb"] })).toBe(
			false,
		);
	});

	// An approved app must not turn into another app after the review.
	it.each([
		["the name", { name: "UrantiaHub" }],
		["the logo", { logoUrl: "https://x/other.png" }],
		["a removed logo", { logoUrl: null }],
		[
			"a new return address",
			{ redirectUris: ["https://a/cb", "https://b/cb", "https://evil.example/cb"] },
		],
		["a changed return address", { redirectUris: ["https://a/cb", "https://evil.example/cb"] }],
		// Approved for the profile, then asks for the notes of each reader.
		["a new permission", { scopes: ["profile", "bookmarks", "notes"] }],
	])("is true for %s", (_name, change) => {
		expect(needsReview(before, { ...before, ...change })).toBe(true);
	});

	it("is false when a return address or a permission is only removed", () => {
		expect(needsReview(before, { ...before, redirectUris: ["https://a/cb"] })).toBe(false);
		expect(needsReview(before, { ...before, scopes: ["profile"] })).toBe(false);
	});
});

// The route reads the app, then writes. An admin can suspend the app between the two.
// So an edit never writes a status that it read: it only names the statuses that it moves to pending.
describe("reviewStatusChange", () => {
	it("moves an approved or a declined app to pending when the edit needs a review", () => {
		expect(reviewStatusChange(true, false)).toEqual({
			from: ["approved", "declined"],
			to: "pending",
		});
	});
	it("changes nothing for another edit, or for an edit by an admin", () => {
		expect(reviewStatusChange(false, false)).toBeNull();
		expect(reviewStatusChange(true, true)).toBeNull();
	});
	it("can never lift a suspension or approve an app", () => {
		const change = reviewStatusChange(true, false);
		expect(change?.to).toBe("pending");
		expect(change?.from).not.toContain("suspended");
	});
});

describe("isWebLink", () => {
	it("takes a plain https address", () => {
		expect(isWebLink("https://app.example/about")).toBe(true);
		expect(isWebLink("https://my-app.example.org:8443/x?y=1")).toBe(true);
	});

	it.each([
		"http://app.example",
		"javascript:alert(1)",
		"data:text/html,x",
		"app.example",
		"",
		"https://",
		"https://nodot",
	])("refuses %j", (bad) => {
		expect(isWebLink(bad)).toBe(false);
	});

	// The admin reads the link as text. The host that a browser would open must be the host that it shows.
	it.each([
		["a name before an @", "https://accounts.urantiahub.com@evil.example/"],
		["a name and a password", "https://user:pass@evil.example/"],
		["a backslash", "https://accounts.urantiahub.com\\@evil.example/"],
		["a host in another script", "https://urаntiahub.com/"],
		["a host in its coded form", "https://xn--urntiahub-2fg.com/"],
		["a space", "https://app.example/ x"],
		["a new line", "https://app.example/\nDecide here: https://evil.example"],
		["a host that is a number", "https://2130706433/"],
	])("refuses %s", (_name, bad) => {
		expect(isWebLink(bad)).toBe(false);
	});
});

// Each new app sends an email to the admin. One reader must not be able to send a hundred.
describe("canRegisterAnother", () => {
	it("stops at three apps that wait for a review", () => {
		expect(canRegisterAnother(0)).toBe(true);
		expect(canRegisterAnother(2)).toBe(true);
		expect(canRegisterAnother(3)).toBe(false);
	});
});

describe("isAppStatus", () => {
	it("knows the four", () => {
		for (const s of ["pending", "approved", "declined", "suspended"])
			expect(isAppStatus(s)).toBe(true);
		expect(isAppStatus("open")).toBe(false);
		expect(isAppStatus(undefined)).toBe(false);
	});
});
