import { describe, expect, it } from "bun:test";
import {
	type AppStatus,
	canUseApp,
	isAppStatus,
	needsReview,
	statusAfterEdit,
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
	])("is true for %s", (_name, change) => {
		expect(needsReview(before, { ...before, ...change })).toBe(true);
	});

	it("is false when a return address is only removed", () => {
		expect(needsReview(before, { ...before, redirectUris: ["https://a/cb"] })).toBe(false);
	});
});

describe("statusAfterEdit", () => {
	it("sends an approved app back to pending when the edit needs a review", () => {
		expect(statusAfterEdit("approved", true, false)).toBe("pending");
	});
	it("keeps an approved app approved for another edit, and for an edit by an admin", () => {
		expect(statusAfterEdit("approved", false, false)).toBe("approved");
		expect(statusAfterEdit("approved", true, true)).toBe("approved");
	});
	it("sends a declined app back to pending when its owner changes it, so the admin looks again", () => {
		expect(statusAfterEdit("declined", true, false)).toBe("pending");
		expect(statusAfterEdit("declined", false, false)).toBe("declined");
	});
	it("never lifts a suspension through an edit", () => {
		expect(statusAfterEdit("suspended", true, false)).toBe("suspended");
		expect(statusAfterEdit("suspended", true, true)).toBe("suspended");
	});
	it("keeps a pending app pending", () => {
		expect(statusAfterEdit("pending", true, false)).toBe("pending");
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
