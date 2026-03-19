import { z } from "zod";

// --- Shared ---

export const PaginationQuery = z.object({
	page: z.coerce.number().int().min(0).default(0).optional(),
	limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

export const ParagraphSummarySchema = z.object({
	paragraphId: z.string(),
	standardReferenceId: z.string(),
	paperId: z.string(),
	paperSectionId: z.string(),
	paperSectionParagraphId: z.string(),
	paperTitle: z.string(),
	sectionTitle: z.string().nullable(),
	text: z.string(),
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

export const BookmarkCreate = z.object({
	ref: z.string().describe("Paragraph reference in any format: globalId (1:2.0.1), standardReferenceId (2:0.1), or paperSectionParagraphId (2.0.1)"),
	category: z.string().max(100).optional(),
});

export const BookmarkResponse = z.object({
	id: z.string().uuid(),
	category: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	paragraph: ParagraphSummarySchema,
});

// --- Notes ---

export const NoteCreate = z.object({
	ref: z.string().describe("Paragraph reference in any format"),
	text: z.string().min(1).max(100_000),
	format: z.enum(["plain", "markdown"]).default("plain").optional(),
});

export const NoteUpdate = z.object({
	text: z.string().min(1).max(100_000).optional(),
	format: z.enum(["plain", "markdown"]).optional(),
});

export const NoteResponse = z.object({
	id: z.string().uuid(),
	text: z.string(),
	format: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
	paragraph: ParagraphSummarySchema,
});

// --- Reading Progress ---

export const ReadingProgressBatch = z.object({
	refs: z.array(z.string()).min(1).max(500).describe("Paragraph references in any format"),
});

export const ReadingProgressSummary = z.object({
	paperId: z.string(),
	readCount: z.number().int(),
});

// --- Preferences ---

export const PreferencesUpdate = z.record(z.string(), z.unknown());
