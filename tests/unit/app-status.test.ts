import { describe, expect, it } from "bun:test";
import {
	type AppStatus,
	canRegisterAnother,
	canUseApp,
	isAppStatus,
	isWebLink,
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
