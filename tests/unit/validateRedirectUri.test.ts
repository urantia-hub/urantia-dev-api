import { describe, expect, it } from "bun:test";

/**
 * Since validateRedirectUri is private in the route file,
 * we replicate the logic here for unit testing.
 * Keep in sync with src/routes/auth.ts.
 */
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

describe("validateRedirectUri", () => {
	describe("allowed schemes", () => {
		it("accepts https:// URLs", () => {
			expect(validateRedirectUri("https://myapp.com/callback")).toBeNull();
		});

		it("accepts http://localhost", () => {
			expect(validateRedirectUri("http://localhost:3000/callback")).toBeNull();
		});

		it("accepts http://127.0.0.1", () => {
			expect(validateRedirectUri("http://127.0.0.1:8080/callback")).toBeNull();
		});

		it("accepts custom URL schemes (native apps)", () => {
			expect(validateRedirectUri("urantiahub://auth/callback")).toBeNull();
		});

		it("accepts expo scheme", () => {
			expect(validateRedirectUri("exp://192.168.1.1:8081/--/auth/callback")).toBeNull();
		});

		it("accepts myapp:// custom scheme", () => {
			expect(validateRedirectUri("myapp://callback")).toBeNull();
		});
	});

	describe("blocked schemes", () => {
		it("rejects javascript:", () => {
			const result = validateRedirectUri("javascript:alert(1)");
			expect(result).toContain("Blocked scheme");
		});

		it("rejects data:", () => {
			const result = validateRedirectUri("data:text/html,<h1>hi</h1>");
			expect(result).toContain("Blocked scheme");
		});

		it("rejects file:", () => {
			const result = validateRedirectUri("file:///etc/passwd");
			expect(result).toContain("Blocked scheme");
		});

		it("rejects ftp:", () => {
			const result = validateRedirectUri("ftp://evil.com/payload");
			expect(result).toContain("Blocked scheme");
		});

		it("rejects blob:", () => {
			const result = validateRedirectUri("blob:http://example.com/uuid");
			expect(result).toContain("Blocked scheme");
		});
	});

	describe("http restrictions", () => {
		it("rejects http:// for non-localhost domains", () => {
			const result = validateRedirectUri("http://example.com/callback");
			expect(result).toContain("http:// is only allowed for localhost");
		});
	});

	describe("invalid URIs", () => {
		it("rejects empty string", () => {
			const result = validateRedirectUri("");
			expect(result).toContain("Invalid URL");
		});

		it("rejects malformed URI", () => {
			const result = validateRedirectUri("not a url");
			expect(result).toContain("Invalid URL");
		});
	});
});
