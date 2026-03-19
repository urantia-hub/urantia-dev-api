import { createRoute } from "@hono/zod-openapi";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client.ts";
import { bookmarks, notes, readingProgress, userPreferences, users } from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import { problemJson } from "../lib/errors.ts";
import { lookupParagraphs, resolveParagraphRef } from "../lib/paragraph-lookup.ts";
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
		200: { description: "User profile", content: { "application/json": { schema: z.object({ data: UserProfile }) } } },
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
	return c.json({ data: { id: updated.id, email: updated.email, name: updated.name, avatarUrl: updated.avatarUrl } }, 200);
});

const deleteProfileRoute = createRoute({
	operationId: "deleteProfile",
	method: "delete",
	path: "/",
	tags: ["User"],
	summary: "Delete account and all data",
	responses: {
		204: { description: "Account deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteProfileRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	await db.delete(users).where(eq(users.id, user.id));
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
	request: { query: PaginationQuery.extend({ paperId: z.string().optional(), category: z.string().optional() }) },
	responses: {
		200: {
			description: "Bookmark list",
			content: { "application/json": { schema: z.object({ data: z.array(BookmarkResponse), pagination: z.object({ page: z.number(), limit: z.number(), total: z.number() }) }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listBookmarksRoute, async (c) => {
	const user = getUser(c);
	const { page = 0, limit = 20, paperId, category } = c.req.valid("query");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const conditions = [eq(bookmarks.userId, user.id)];
	if (paperId) conditions.push(eq(bookmarks.paperId, paperId));
	if (category) conditions.push(eq(bookmarks.category, category));
	const where = and(...conditions);

	const [rows, [{ value: total }]] = await Promise.all([
		db.select().from(bookmarks).where(where).orderBy(bookmarks.createdAt).limit(limit).offset(page * limit),
		db.select({ value: count() }).from(bookmarks).where(where),
	]);

	// Enrich with full paragraph entities
	const globalIds = rows.map((r) => r.paragraphId);
	const paragraphMap = await lookupParagraphs(db, globalIds);

	const data = rows
		.filter((r) => paragraphMap.has(r.paragraphId))
		.map((r) => ({
			id: r.id,
			category: r.category,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
			paragraph: paragraphMap.get(r.paragraphId)!,
		}));

	return c.json({ data, pagination: { page, limit, total } }, 200);
});

const listBookmarkCategoriesRoute = createRoute({
	operationId: "listBookmarkCategories",
	method: "get",
	path: "/bookmarks/categories",
	tags: ["Bookmarks"],
	summary: "List bookmark categories",
	responses: {
		200: { description: "Category list", content: { "application/json": { schema: z.object({ data: z.array(z.string()) }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listBookmarkCategoriesRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	const rows = await db.selectDistinct({ category: bookmarks.category }).from(bookmarks).where(eq(bookmarks.userId, user.id));
	const categories = rows.map((r) => r.category).filter((c): c is string => c !== null).sort();
	return c.json({ data: categories }, 200);
});

const createBookmarkRoute = createRoute({
	operationId: "createBookmark",
	method: "post",
	path: "/bookmarks",
	tags: ["Bookmarks"],
	summary: "Create a bookmark",
	description: "Pass any paragraph reference format. The API resolves it and returns the enriched paragraph data.",
	request: { body: { content: { "application/json": { schema: BookmarkCreate } } } },
	responses: {
		200: { description: "Bookmark already exists (idempotent)", content: { "application/json": { schema: z.object({ data: BookmarkResponse }) } } },
		201: { description: "Bookmark created", content: { "application/json": { schema: z.object({ data: BookmarkResponse }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Paragraph not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(createBookmarkRoute, async (c) => {
	const user = getUser(c);
	const { ref, category } = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const resolved = await resolveParagraphRef(db, ref);
	if (!resolved) return problemJson(c, 404, `Paragraph "${ref}" not found.`);

	// Idempotent: if bookmark exists, update category (if provided) and return it
	const [existing] = await db
		.select()
		.from(bookmarks)
		.where(and(eq(bookmarks.userId, user.id), eq(bookmarks.paragraphId, resolved.globalId)))
		.limit(1);

	if (existing) {
		// Update category if a new one was provided
		if (category !== undefined && category !== existing.category) {
			await db.update(bookmarks).set({ category, updatedAt: new Date() }).where(eq(bookmarks.id, existing.id));
			existing.category = category;
			existing.updatedAt = new Date();
		}
		return c.json({
			data: {
				id: existing.id,
				category: existing.category,
				createdAt: existing.createdAt.toISOString(),
				updatedAt: existing.updatedAt.toISOString(),
				paragraph: resolved.paragraph,
			},
		}, 200);
	}

	const [created] = await db
		.insert(bookmarks)
		.values({
			userId: user.id,
			paragraphId: resolved.globalId,
			paperId: resolved.paperId,
			paperSectionId: resolved.paperSectionId,
			paperSectionParagraphId: resolved.paperSectionParagraphId,
			category: category ?? null,
		})
		.returning();

	return c.json({
		data: {
			id: created.id,
			category: created.category,
			createdAt: created.createdAt.toISOString(),
			updatedAt: created.updatedAt.toISOString(),
			paragraph: resolved.paragraph,
		},
	}, 201);
});

const deleteBookmarkRoute = createRoute({
	operationId: "deleteBookmark",
	method: "delete",
	path: "/bookmarks/{ref}",
	tags: ["Bookmarks"],
	summary: "Delete a bookmark by paragraph reference",
	request: {
		params: z.object({ ref: z.string().describe("Paragraph reference in any format") }),
	},
	responses: {
		204: { description: "Bookmark(s) deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Bookmark not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteBookmarkRoute, async (c) => {
	const user = getUser(c);
	const { ref } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const resolved = await resolveParagraphRef(db, ref);
	if (!resolved) return problemJson(c, 404, `Paragraph "${ref}" not found.`);

	const deleted = await db
		.delete(bookmarks)
		.where(and(eq(bookmarks.userId, user.id), eq(bookmarks.paragraphId, resolved.globalId)))
		.returning();
	if (deleted.length === 0) return problemJson(c, 404, "Bookmark not found.");
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
	request: { query: PaginationQuery.extend({ paperId: z.string().optional(), paragraphId: z.string().optional() }) },
	responses: {
		200: {
			description: "Note list",
			content: { "application/json": { schema: z.object({ data: z.array(NoteResponse), pagination: z.object({ page: z.number(), limit: z.number(), total: z.number() }) }) } },
		},
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(listNotesRoute, async (c) => {
	const user = getUser(c);
	const { page = 0, limit = 20, paperId, paragraphId } = c.req.valid("query");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const conditions = [eq(notes.userId, user.id)];
	if (paperId) conditions.push(eq(notes.paperId, paperId));
	if (paragraphId) conditions.push(eq(notes.paragraphId, paragraphId));
	const where = and(...conditions);

	const [rows, [{ value: total }]] = await Promise.all([
		db.select().from(notes).where(where).orderBy(notes.createdAt).limit(limit).offset(page * limit),
		db.select({ value: count() }).from(notes).where(where),
	]);

	const globalIds = rows.map((r) => r.paragraphId);
	const paragraphMap = await lookupParagraphs(db, globalIds);

	const data = rows
		.filter((r) => paragraphMap.has(r.paragraphId))
		.map((r) => ({
			id: r.id,
			text: r.text,
			format: r.format,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
			paragraph: paragraphMap.get(r.paragraphId)!,
		}));

	return c.json({ data, pagination: { page, limit, total } }, 200);
});

const createNoteRoute = createRoute({
	operationId: "createNote",
	method: "post",
	path: "/notes",
	tags: ["Notes"],
	summary: "Create a note",
	description: "Pass any paragraph reference format. Multiple notes per paragraph are allowed.",
	request: { body: { content: { "application/json": { schema: NoteCreate } } } },
	responses: {
		201: { description: "Note created", content: { "application/json": { schema: z.object({ data: NoteResponse }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Paragraph not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(createNoteRoute, async (c) => {
	const user = getUser(c);
	const { ref, text, format } = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const resolved = await resolveParagraphRef(db, ref);
	if (!resolved) return problemJson(c, 404, `Paragraph "${ref}" not found.`);

	const [created] = await db
		.insert(notes)
		.values({
			userId: user.id,
			paragraphId: resolved.globalId,
			paperId: resolved.paperId,
			paperSectionId: resolved.paperSectionId,
			paperSectionParagraphId: resolved.paperSectionParagraphId,
			text,
			format: format ?? "plain",
		})
		.returning();

	return c.json({
		data: {
			id: created.id,
			text: created.text,
			format: created.format,
			createdAt: created.createdAt.toISOString(),
			updatedAt: created.updatedAt.toISOString(),
			paragraph: resolved.paragraph,
		},
	}, 201);
});

const updateNoteRoute = createRoute({
	operationId: "updateNote",
	method: "put",
	path: "/notes/{id}",
	tags: ["Notes"],
	summary: "Update a note",
	request: { params: z.object({ id: z.string().uuid() }), body: { content: { "application/json": { schema: NoteUpdate } } } },
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

	const [updated] = await db.update(notes).set(updates).where(and(eq(notes.id, id), eq(notes.userId, user.id))).returning();
	if (!updated) return problemJson(c, 404, "Note not found.");

	const paragraphMap = await lookupParagraphs(db, [updated.paragraphId]);
	const paragraph = paragraphMap.get(updated.paragraphId);
	return c.json({
		data: {
			id: updated.id,
			text: updated.text,
			format: updated.format,
			createdAt: updated.createdAt.toISOString(),
			updatedAt: updated.updatedAt.toISOString(),
			...(paragraph ? { paragraph } : {}),
		},
	}, 200);
});

const deleteNoteByIdRoute = createRoute({
	operationId: "deleteNoteById",
	method: "delete",
	path: "/notes/{id}",
	tags: ["Notes"],
	summary: "Delete a note by ID",
	description: "Delete a specific note by its UUID. Use this when a user has multiple notes on the same paragraph.",
	request: { params: z.object({ id: z.string().uuid() }) },
	responses: {
		204: { description: "Note deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Note not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteNoteByIdRoute, async (c) => {
	const user = getUser(c);
	const { id } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);
	const deleted = await db.delete(notes).where(and(eq(notes.id, id), eq(notes.userId, user.id))).returning();
	if (deleted.length === 0) return problemJson(c, 404, "Note not found.");
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
		200: { description: "Reading progress per paper", content: { "application/json": { schema: z.object({ data: z.array(ReadingProgressSummary) }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(getReadingProgressRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	const rows = await db
		.select({ paperId: readingProgress.paperId, readCount: count() })
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
	description: "Pass an array of paragraph references in any format. Already-read paragraphs are silently skipped (idempotent).",
	request: { body: { content: { "application/json": { schema: ReadingProgressBatch } } } },
	responses: {
		200: { description: "Paragraphs marked as read", content: { "application/json": { schema: z.object({ marked: z.number() }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(markReadRoute, async (c) => {
	const user = getUser(c);
	const { refs } = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const resolved = await Promise.all(refs.map((ref) => resolveParagraphRef(db, ref)));
	const valid = resolved.filter((r): r is NonNullable<typeof r> => r !== null);
	if (valid.length === 0) return c.json({ marked: 0 }, 200);

	const values = valid.map((item) => ({
		userId: user.id,
		paragraphId: item.globalId,
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
	path: "/reading-progress/{ref}",
	tags: ["Reading Progress"],
	summary: "Unmark a paragraph as read",
	request: { params: z.object({ ref: z.string().describe("Paragraph reference in any format") }) },
	responses: {
		204: { description: "Reading progress deleted" },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
		404: { description: "Not found", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(deleteReadingProgressRoute, async (c) => {
	const user = getUser(c);
	const { ref } = c.req.valid("param");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const resolved = await resolveParagraphRef(db, ref);
	if (!resolved) return problemJson(c, 404, `Paragraph "${ref}" not found.`);

	const deleted = await db
		.delete(readingProgress)
		.where(and(eq(readingProgress.userId, user.id), eq(readingProgress.paragraphId, resolved.globalId)))
		.returning();
	if (deleted.length === 0) return problemJson(c, 404, "Reading progress entry not found.");
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
		200: { description: "User preferences", content: { "application/json": { schema: z.object({ data: z.record(z.unknown()) }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(getPreferencesRoute, async (c) => {
	const user = getUser(c);
	const { db } = getDb(c.env?.HYPERDRIVE);
	const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
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
		200: { description: "Updated preferences", content: { "application/json": { schema: z.object({ data: z.record(z.unknown()) }) } } },
		401: { description: "Authentication required", content: { "application/json": { schema: ErrorResponse } } },
	},
});

meRoute.openapi(updatePreferencesRoute, async (c) => {
	const user = getUser(c);
	const body = c.req.valid("json");
	const { db } = getDb(c.env?.HYPERDRIVE);

	const [existing] = await db.select().from(userPreferences).where(eq(userPreferences.userId, user.id)).limit(1);
	const merged = { ...((existing?.preferences as Record<string, unknown>) ?? {}), ...body };

	if (existing) {
		await db.update(userPreferences).set({ preferences: merged, updatedAt: new Date() }).where(eq(userPreferences.userId, user.id));
	} else {
		await db.insert(userPreferences).values({ userId: user.id, preferences: merged });
	}

	return c.json({ data: merged }, 200);
});
