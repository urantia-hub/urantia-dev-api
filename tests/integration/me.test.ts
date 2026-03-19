import { describe, expect, it } from "bun:test";
import { del, get, post, put } from "../helpers/app.ts";

// All /me/* endpoints require authentication.
// Without SUPABASE_URL in test env, any Bearer token will return 401.
// These tests verify auth enforcement and response shapes.

describe("GET /me/bookmarks — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await get("/me/bookmarks");
		expect(res.status).toBe(401);
	});
});

describe("GET /me/bookmarks/categories — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await get("/me/bookmarks/categories");
		expect(res.status).toBe(401);
	});
});

describe("POST /me/bookmarks — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await post("/me/bookmarks", {
			paragraphId: "1:0.1",
			paperId: "1",
			paperSectionId: "1:0",
			paperSectionParagraphId: "1:0.1",
		});
		expect(res.status).toBe(401);
	});
});

describe("DELETE /me/bookmarks/:id — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await del("/me/bookmarks/00000000-0000-0000-0000-000000000000");
		expect(res.status).toBe(401);
	});
});

describe("GET /me/notes — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await get("/me/notes");
		expect(res.status).toBe(401);
	});
});

describe("POST /me/notes — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await post("/me/notes", {
			paragraphId: "1:0.1",
			paperId: "1",
			paperSectionId: "1:0",
			paperSectionParagraphId: "1:0.1",
			text: "Test note",
		});
		expect(res.status).toBe(401);
	});
});

describe("PUT /me/notes/:id — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await put("/me/notes/00000000-0000-0000-0000-000000000000", { text: "Updated" });
		expect(res.status).toBe(401);
	});
});

describe("DELETE /me/notes/:id — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await del("/me/notes/00000000-0000-0000-0000-000000000000");
		expect(res.status).toBe(401);
	});
});

describe("GET /me/reading-progress — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await get("/me/reading-progress");
		expect(res.status).toBe(401);
	});
});

describe("POST /me/reading-progress — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await post("/me/reading-progress", {
			items: [{ paragraphId: "1:0.1", paperId: "1", paperSectionId: "1:0", paperSectionParagraphId: "1:0.1" }],
		});
		expect(res.status).toBe(401);
	});
});

describe("DELETE /me/reading-progress/:id — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await del("/me/reading-progress/00000000-0000-0000-0000-000000000000");
		expect(res.status).toBe(401);
	});
});

describe("GET /me/preferences — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await get("/me/preferences");
		expect(res.status).toBe(401);
	});
});

describe("PUT /me/preferences — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await put("/me/preferences", { theme: "dark" });
		expect(res.status).toBe(401);
	});
});

describe("PUT /me — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await put("/me", { name: "Test" });
		expect(res.status).toBe(401);
	});
});

describe("DELETE /me — requires auth", () => {
	it("returns 401 without auth", async () => {
		const res = await del("/me");
		expect(res.status).toBe(401);
	});
});
