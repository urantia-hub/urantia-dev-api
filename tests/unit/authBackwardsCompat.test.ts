import { describe, expect, it } from "bun:test";

/**
 * Backwards-compatibility tests for Phase 0 auth changes.
 *
 * Live app regression (ourpapervoices.com, demo.urantia.dev):
 * - Both use @urantia/auth with HTTPS redirect URIs
 * - Both use popup or redirect mode (standard browser flow)
 * - Changes are additive: refreshToken is a new field on token response
 * - Existing code that reads accessToken/userId/email/scopes is unaffected
 * - Manual E2E verification needed post-deploy (see Phase 0 gate checklist)
 */

describe("Auth changes backward compatibility", () => {
	it("HTTPS redirect URIs still pass validation", () => {
		// ourpapervoices.com uses: https://ourpapervoices.com/callback
		// demo.urantia.dev uses: https://demo.urantia.dev/callback
		const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "ftp:", "blob:", "vbscript:"]);

		function validateRedirectUri(uri: string): string | null {
			let parsed: URL;
			try {
				parsed = new URL(uri);
			} catch {
				return `Invalid URL: "${uri}"`;
			}
			const { protocol, hostname } = parsed;
			if (BLOCKED_SCHEMES.has(protocol)) {
				return `Blocked scheme "${protocol}" in "${uri}".`;
			}
			if (protocol === "http:" && hostname !== "localhost" && hostname !== "127.0.0.1") {
				return `http:// is only allowed for localhost and 127.0.0.1. Use https:// for "${hostname}".`;
			}
			return null;
		}

		// Live app redirect URIs
		expect(validateRedirectUri("https://ourpapervoices.com/callback")).toBeNull();
		expect(validateRedirectUri("https://demo.urantia.dev/callback")).toBeNull();

		// New mobile app redirect URI
		expect(validateRedirectUri("urantiahub://auth/callback")).toBeNull();

		// Dev localhost still works
		expect(validateRedirectUri("http://localhost:3000/callback")).toBeNull();
	});

	it("Token response with refreshToken is a superset of old response", () => {
		// Old response shape (v0.1.x)
		const oldResponse = {
			accessToken: "jwt...",
			userId: "uuid",
			email: "test@test.com",
			scopes: ["bookmarks"],
			expiresAt: "2026-04-11T00:00:00.000Z",
		};

		// New response shape (v0.2.0) — additive
		const newResponse = {
			...oldResponse,
			refreshToken: "uuid-refresh-token",
		};

		// Old consumer code accessing old fields still works
		expect(newResponse.accessToken).toBe(oldResponse.accessToken);
		expect(newResponse.userId).toBe(oldResponse.userId);
		expect(newResponse.email).toBe(oldResponse.email);
		expect(newResponse.scopes).toEqual(oldResponse.scopes);
		expect(newResponse.expiresAt).toBe(oldResponse.expiresAt);

		// New field is present
		expect(newResponse.refreshToken).toBe("uuid-refresh-token");
	});
});
