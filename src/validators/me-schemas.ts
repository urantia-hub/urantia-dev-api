import { z } from "zod";

// --- Shared ---

export const ParagraphRefs = z.object({
	paragraphId: z.string().describe("Paragraph globalId, e.g. '0:1.1'"),
	paperId: z.string().describe("Paper ID, e.g. '1'"),
	paperSectionId: z.string().describe("Paper:Section ID, e.g. '1:2'"),
	paperSectionParagraphId: z.string().describe("Paper:Section.Paragraph ID, e.g. '1:2.3'"),
});

export const PaginationQuery = z.object({
	page: z.coerce.number().int().min(0).default(0).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

// --- User Profile ---

export const UserProfile = z.object({
	id: z.string().uuid(),
	email: z.string().nullable(),
	name: z.string().nullable(),
	avatarUrl: z.string().nullable(),
});

export const UserUpdate = z.object({
	name: z.string().max(200).optional(),
	avatarUrl: z.string().url().max(2000).optional(),
});

// --- Bookmarks ---

export const BookmarkCreate = ParagraphRefs.extend({
	category: z.string().max(100).optional(),
});

export const BookmarkResponse = z.object({
	id: z.string().uuid(),
	paragraphId: z.string(),
	paperId: z.string(),
	paperSectionId: z.string(),
	paperSectionParagraphId: z.string(),
	category: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

// --- Notes ---

export const NoteCreate = ParagraphRefs.extend({
	text: z.string().min(1).max(100_000),
	format: z.enum(["plain", "markdown"]).default("plain").optional(),
});

export const NoteUpdate = z.object({
	text: z.string().min(1).max(100_000).optional(),
	format: z.enum(["plain", "markdown"]).optional(),
});

export const NoteResponse = z.object({
	id: z.string().uuid(),
	paragraphId: z.string(),
	paperId: z.string(),
	paperSectionId: z.string(),
	paperSectionParagraphId: z.string(),
	text: z.string(),
	format: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});

// --- Reading Progress ---

export const ReadingProgressItem = ParagraphRefs;

export const ReadingProgressBatch = z.object({
	items: z.array(ReadingProgressItem).min(1).max(500),
});

export const ReadingProgressSummary = z.object({
	paperId: z.string(),
	readCount: z.number().int(),
});

// --- Preferences ---

export const PreferencesUpdate = z.record(z.string(), z.unknown());
