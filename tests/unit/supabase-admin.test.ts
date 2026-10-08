import { describe, expect, it } from "bun:test";
import { adminSettings, removeSignIn } from "../../src/lib/supabase-admin.ts";

const ID = "00000000-0000-4000-8000-000000000001";
const settings = { url: "https://project.supabase.co", key: "service-key-for-tests" };

function fakeFetch(status: number) {
	const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
	const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
		calls.push({
			url: String(url),
			method: init?.method ?? "GET",
			headers: Object.fromEntries(new Headers(init?.headers).entries()),
		});
		return new Response(status === 204 ? null : "{}", { status });
	}) as typeof fetch;
	return { calls, fetcher };
}

describe("adminSettings", () => {
	it("is null without the URL or without the key, so a delete stops before it removes anything", () => {
		expect(adminSettings({ SUPABASE_URL: settings.url })).toBeNull();
		expect(adminSettings({ SUPABASE_SERVICE_ROLE_KEY: "k" })).toBeNull();
		expect(
			adminSettings({ SUPABASE_URL: settings.url, SUPABASE_SERVICE_ROLE_KEY: " " }),
		).toBeNull();
	});
	it("reads both", () => {
		expect(
			adminSettings({ SUPABASE_URL: `${settings.url}/`, SUPABASE_SERVICE_ROLE_KEY: "k" }),
		).toEqual({
			url: settings.url,
			key: "k",
		});
	});
});

describe("removeSignIn", () => {
	it("deletes that one user with the service key", async () => {
		const { calls, fetcher } = fakeFetch(200);
		await removeSignIn(settings, ID, fetcher);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe(`https://project.supabase.co/auth/v1/admin/users/${ID}`);
		expect(calls[0]?.method).toBe("DELETE");
		expect(calls[0]?.headers.authorization).toBe("Bearer service-key-for-tests");
		expect(calls[0]?.headers.apikey).toBe("service-key-for-tests");
	});

	// A second run of a delete that failed after this step.
	it("is done when the user is gone already", async () => {
		await removeSignIn(settings, ID, fakeFetch(404).fetcher);
	});

	it("throws on any other answer, and the error does not hold the key", async () => {
		for (const status of [401, 403, 500]) {
			const error = await removeSignIn(settings, ID, fakeFetch(status).fetcher).catch((e) => e);
			expect(error).toBeInstanceOf(Error);
			expect(String(error.message)).toContain(String(status));
			expect(String(error.message)).not.toContain("service-key");
		}
	});

	// The id goes into a path. Only a real user id can go there.
	it("refuses an id that is not a user id, with no request", async () => {
		const { calls, fetcher } = fakeFetch(200);
		for (const id of ["", "../users", "abc", `${ID}/factors`]) {
			await expect(removeSignIn(settings, id, fetcher)).rejects.toThrow();
		}
		expect(calls).toEqual([]);
	});
});
