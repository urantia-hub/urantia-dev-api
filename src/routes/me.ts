import { createRoute } from "@hono/zod-openapi";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { bookmarks, notes, readingProgress, userPreferences, users } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import type { AuthUser } from "../middleware/auth.ts";
import { ErrorResponse } from "../validators/schemas.ts";
import {
	BookmarkCreate,
	BookmarkResponse,
	NoteCreate,
	NoteResponse,
	NoteUpdate,
	PaginationQuery,
	PreferencesUpdate,
	ReadingProgressBatch,
	ReadingProgressSummary,
	UserProfile,
	UserUpdate,
} from "../validators/me-schemas.ts";

export const meRoute = createApp();

// Helper: get authenticated user or throw
function getUser(c: { get: (key: "user") => AuthUser | null }): AuthUser {
	const user = c.get("user");
	if (!user) throw new Error("User not authenticated");
	return user;
}

// ============================================================
// Profile
// ============================================================

const getProfileRoute = createRoute({
	operationId: "getProfile",
	method: "get",
	path: "/",
	tags: ["User"],
	summary: "Get authenticated user profile",
	responses: {
		200: {
			description: "User profile",
			content: { "application/json": { schema: z.object({ data: UserProfile }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(getProfileRoute, async (c) => {
	const user = getUser(c);
	return c.json({ data: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } }, 200);
});

const updateProfileRoute = createRoute({
	operationId: "updateProfile",
	method: "put",
	path: "/",
	tags: ["User"],
	summary: "Update user profile",
	request: { body: { content: { "application/json": { schema: UserUpdate } } } },
	responses: {
		200: { description: "Updated profile", content: { "application/json": { schema: z.object({ data: UserProfile }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(updateProfileRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (body.name !== undefined) updates.name = body.name;
	if (body.avatarUrl !== undefined) updates.avatarUrl = body.avatarUrl;

	await db.update(users).set(updates).where(eq(users.id, user.id));

	const [updated] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
	return c.json({
		data: { id: updated.id, email: updated.email, name: updated.name, avatarUrl: updated.avatarUrl },
	}, 200);
});

const deleteProfileRoute = createRoute({
	operationId: "deleteProfile",
	method: "delete",
	path: "/",
	tags: ["User"],
	summary: "Delete account and all data",
	description: "Permanently deletes the user account and all associated data (bookmarks, notes, reading progress). This action cannot be undone.",
	responses: {
		204: { description: "Account deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteProfileRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	await db.delete(users).where(eq(users.id, user.id)); // CASCADE handles all related data
	return c.body(null, 204);
});

// ============================================================
// Bookmarks
// ============================================================

const listBookmarksRoute = createRoute({
	operationId: "listBookmarks",
	method: "get",
	path: "/bookmarks",
	tags: ["Bookmarks"],
	summary: "List bookmarks",
	request: {
		query: PaginationQuery.extend({
			paper_id: z.string().optional(),
			category: z.string().optional(),
		}),
	},
	responses: {
		200: {
			description: "Bookmark list",
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(BookmarkResponse),
						pagination: z.object({ page: z.number(), limit: z.number(), total: z.number() }),
					}),
				},
			},
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listBookmarksRoute, async (c) => {
	const user = getUser(c);
	const { page = 0, limit = 20, paper_id, category } = c.req.valid("query");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const conditions = [eq(bookmarks.userId, user.id)];
	if (paper_id) conditions.push(eq(bookmarks.paperId, paper_id));
	if (category) conditions.push(eq(bookmarks.category, category));

	const where = and(...conditions);
	const [rows, [{ value: total }]] = await Promise.all([
		db.select().from(bookmarks).where(where).orderBy(bookmarks.createdAt).limit(limit).offset(page * limit),
		db.select({ value: count() }).from(bookmarks).where(where),
	]);

	return c.json({
		data: rows.map((r) => ({
			...r,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
		})),
		pagination: { page, limit, total },
	}, 200);
});

const listBookmarkCategoriesRoute = createRoute({
	operationId: "listBookmarkCategories",
	method: "get",
	path: "/bookmarks/categories",
	tags: ["Bookmarks"],
	summary: "List bookmark categories",
	responses: {
		200: {
			description: "Category list",
			content: { "application/json": { schema: z.object({ data: z.array(z.string()) }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listBookmarkCategoriesRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);

	const rows = await db
		.selectDistinct({ category: bookmarks.category })
		.from(bookmarks)
		.where(eq(bookmarks.userId, user.id));

	const categories = rows.map((r) => r.category).filter((c): c is string => c !== null).sort();
	return c.json({ data: categories }, 200);
});

const createBookmarkRoute = createRoute({
	operationId: "createBookmark",
	method: "post",
	path: "/bookmarks",
	tags: ["Bookmarks"],
	summary: "Create a bookmark",
	request: { body: { content: { "application/json": { schema: BookmarkCreate } } } },
	responses: {
		201: { description: "Bookmark created", content: { "application/json": { schema: z.object({ data: BookmarkResponse }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		409: { description: "Bookmark already exists", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(createBookmarkRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Check for duplicate
	const existing = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.userId, user.id), eq(bookmarks.paragraphId, body.paragraphId)))
		.limit(1);

	if (existing.length > 0) {
		return problemJson(c, 400, "Bookmark already exists for this paragraph.");
	}

	const [created] = await db
		.insert(bookmarks)
		.values({
			userId: user.id,
			paragraphId: body.paragraphId,
			paperId: body.paperId,
			paperSectionId: body.paperSectionId,
			paperSectionParagraphId: body.paperSectionParagraphId,
			category: body.category ?? null,
		})
		.returning();

	return c.json({
		data: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() },
	}, 201);
});

const deleteBookmarkRoute = createRoute({
	operationId: "deleteBookmark",
	method: "delete",
	path: "/bookmarks/{id}",
	tags: ["Bookmarks"],
	summary: "Delete a bookmark",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		204: { description: "Bookmark deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Bookmark not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteBookmarkRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const deleted = await db
		.delete(bookmarks)
		.where(and(eq(bookmarks.id, id), eq(bookmarks.userId, user.id)))
		.returning();

	if (deleted.length === 0) {
		return problemJson(c, 404, "Bookmark not found.");
	}

	return c.body(null, 204);
});

// ============================================================
// Notes
// ============================================================

const listNotesRoute = createRoute({
	operationId: "listNotes",
	method: "get",
	path: "/notes",
	tags: ["Notes"],
	summary: "List notes",
	request: {
		query: PaginationQuery.extend({
			paper_id: z.string().optional(),
			paragraph_id: z.string().optional(),
		}),
	},
	responses: {
		200: {
			description: "Note list",
			content: {
				"application/json": {
					schema: z.object({
						data: z.array(NoteResponse),
						pagination: z.object({ page: z.number(), limit: z.number(), total: z.number() }),
					}),
				},
			},
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listNotesRoute, async (c) => {
	const user = getUser(c);
	const { page = 0, limit = 20, paper_id, paragraph_id } = c.req.valid("query");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const conditions = [eq(notes.userId, user.id)];
	if (paper_id) conditions.push(eq(notes.paperId, paper_id));
	if (paragraph_id) conditions.push(eq(notes.paragraphId, paragraph_id));

	const where = and(...conditions);
	const [rows, [{ value: total }]] = await Promise.all([
		db.select().from(notes).where(where).orderBy(notes.createdAt).limit(limit).offset(page * limit),
		db.select({ value: count() }).from(notes).where(where),
	]);

	return c.json({
		data: rows.map((r) => ({
			...r,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
		})),
		pagination: { page, limit, total },
	}, 200);
});

const createNoteRoute = createRoute({
	operationId: "createNote",
	method: "post",
	path: "/notes",
	tags: ["Notes"],
	summary: "Create a note",
	request: { body: { content: { "application/json": { schema: NoteCreate } } } },
	responses: {
		201: { description: "Note created", content: { "application/json": { schema: z.object({ data: NoteResponse }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(createNoteRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [created] = await db
		.insert(notes)
		.values({
			userId: user.id,
			paragraphId: body.paragraphId,
			paperId: body.paperId,
			paperSectionId: body.paperSectionId,
			paperSectionParagraphId: body.paperSectionParagraphId,
			text: body.text,
			format: body.format ?? "plain",
		})
		.returning();

	return c.json({
		data: { ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() },
	}, 201);
});

const updateNoteRoute = createRoute({
	operationId: "updateNote",
	method: "put",
	path: "/notes/{id}",
	tags: ["Notes"],
	summary: "Update a note",
	request: {
		params: z.object({ id: z.string().uuid() }),
		body: { content: { "application/json": { schema: NoteUpdate } } },
	},
	responses: {
		200: { description: "Note updated", content: { "application/json": { schema: z.object({ data: NoteResponse }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Note not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(updateNoteRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const updates: Record<string, unknown> = { updatedAt: new Date() };
	if (body.text !== undefined) updates.text = body.text;
	if (body.format !== undefined) updates.format = body.format;

	const [updated] = await db
		.update(notes)
		.set(updates)
		.where(and(eq(notes.id, id), eq(notes.userId, user.id)))
		.returning();

	if (!updated) {
		return problemJson(c, 404, "Note not found.");
	}

	return c.json({
		data: { ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() },
	}, 200);
});

const deleteNoteRoute = createRoute({
	operationId: "deleteNote",
	method: "delete",
	path: "/notes/{id}",
	tags: ["Notes"],
	summary: "Delete a note",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		204: { description: "Note deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Note not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteNoteRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const deleted = await db
		.delete(notes)
		.where(and(eq(notes.id, id), eq(notes.userId, user.id)))
		.returning();

	if (deleted.length === 0) {
		return problemJson(c, 404, "Note not found.");
	}

	return c.body(null, 204);
});

// ============================================================
// Reading Progress
// ============================================================

const getReadingProgressRoute = createRoute({
	operationId: "getReadingProgress",
	method: "get",
	path: "/reading-progress",
	tags: ["Reading Progress"],
	summary: "Get reading progress summary per paper",
	responses: {
		200: {
			description: "Reading progress per paper",
			content: {
				"application/json": {
					schema: z.object({ data: z.array(ReadingProgressSummary) }),
				},
			},
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(getReadingProgressRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);

	const rows = await db
		.select({
			paperId: readingProgress.paperId,
			readCount: count(),
		})
		.from(readingProgress)
		.where(eq(readingProgress.userId, user.id))
		.groupBy(readingProgress.paperId)
		.orderBy(readingProgress.paperId);

	return c.json({ data: rows }, 200);
});

const markReadRoute = createRoute({
	operationId: "markRead",
	method: "post",
	path: "/reading-progress",
	tags: ["Reading Progress"],
	summary: "Mark paragraphs as read (batch)",
	request: { body: { content: { "application/json": { schema: ReadingProgressBatch } } } },
	responses: {
		200: { description: "Paragraphs marked as read", content: { "application/json": { schema: z.object({ marked: z.number() }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(markReadRoute, async (c) => {
	const user = getUser(c);
	const { items } = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const values = items.map((item) => ({
		userId: user.id,
		paragraphId: item.paragraphId,
		paperId: item.paperId,
		paperSectionId: item.paperSectionId,
		paperSectionParagraphId: item.paperSectionParagraphId,
	}));

	const result = await db
		.insert(readingProgress)
		.values(values)
		.onConflictDoNothing({ target: [readingProgress.userId, readingProgress.paragraphId] })
		.returning();

	return c.json({ marked: result.length }, 200);
});

const deleteReadingProgressRoute = createRoute({
	operationId: "deleteReadingProgress",
	method: "delete",
	path: "/reading-progress/{id}",
	tags: ["Reading Progress"],
	summary: "Unmark a paragraph as read",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		204: { description: "Reading progress deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteReadingProgressRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const deleted = await db
		.delete(readingProgress)
		.where(and(eq(readingProgress.id, id), eq(readingProgress.userId, user.id)))
		.returning();

	if (deleted.length === 0) {
		return problemJson(c, 404, "Reading progress entry not found.");
	}

	return c.body(null, 204);
});

// ============================================================
// Preferences
// ============================================================

const getPreferencesRoute = createRoute({
	operationId: "getPreferences",
	method: "get",
	path: "/preferences",
	tags: ["Preferences"],
	summary: "Get user preferences",
	responses: {
		200: {
			description: "User preferences",
			content: { "application/json": { schema: z.object({ data: z.record(z.unknown()) }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(getPreferencesRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [row] = await db
		.select()
		.from(userPreferences)
		.where(eq(userPreferences.userId, user.id))
		.limit(1);

	return c.json({ data: (row?.preferences as Record<string, unknown>) ?? {} }, 200);
});

const updatePreferencesRoute = createRoute({
	operationId: "updatePreferences",
	method: "put",
	path: "/preferences",
	tags: ["Preferences"],
	summary: "Update user preferences (shallow merge)",
	request: { body: { content: { "application/json": { schema: PreferencesUpdate } } } },
	responses: {
		200: {
			description: "Updated preferences",
			content: { "application/json": { schema: z.object({ data: z.record(z.unknown()) }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(updatePreferencesRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Get existing preferences
	const [existing] = await db
		.select()
		.from(userPreferences)
		.where(eq(userPreferences.userId, user.id))
		.limit(1);

	const merged = { ...((existing?.preferences as Record<string, unknown>) ?? {}), ...body };

	if (existing) {
		await db
			.update(userPreferences)
			.set({ preferences: merged, updatedAt: new Date() })
			.where(eq(userPreferences.userId, user.id));
	} else {
		await db.insert(userPreferences).values({
			userId: user.id,
			preferences: merged,
		});
	}

	return c.json({ data: merged }, 200);
});
