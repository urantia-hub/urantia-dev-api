import { describe, expect, it } from "bun:test";
import { ALLOWED_SCOPES, AppCreateBody } from "../../src/validators/app-schemas.ts";

const base = { id: "my-app", name: "My App", redirectUris: ["https://app.example/cb"] };

// The consent screen has words for each name in the list, and for no other name.
// So an app must not be able to register another name: the reader could not see what it means.
describe("the permissions of a new app", () => {
	it("accepts each permission of the service", () => {
		expect(AppCreateBody.safeParse({ ...base, scopes: [...ALLOWED_SCOPES] }).success).toBe(true);
		expect(ALLOWED_SCOPES).toEqual([
			"profile",
			"bookmarks",
			"notes",
			"reading-progress",
			"preferences",
			"app-data",
		]);
	});

	it.each([
		["free-gift"],
		["constructor"],
		["Your account is locked. Call 555 0100"],
		["Profile"],
		[""],
	])("refuses the name %p", (name) => {
		expect(AppCreateBody.safeParse({ ...base, scopes: ["profile", name] }).success).toBe(false);
	});

	it("refuses an empty list", () => {
		expect(AppCreateBody.safeParse({ ...base, scopes: [] }).success).toBe(false);
	});
});

describe("the name of a new app", () => {
	it("has 100 characters at most, and is not empty", () => {
		const scopes = ["profile"];
		expect(AppCreateBody.safeParse({ ...base, scopes, name: "x".repeat(100) }).success).toBe(true);
		expect(AppCreateBody.safeParse({ ...base, scopes, name: "x".repeat(101) }).success).toBe(false);
		expect(AppCreateBody.safeParse({ ...base, scopes, name: "   " }).success).toBe(false);
	});
});
