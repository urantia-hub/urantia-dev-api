import { z } from "zod";

// --- Shared response schemas ---

export const PaginationMeta = z.object({
	page: z.number().int(),
	limit: z.number().int(),
	total: z.number().int(),
	totalPages: z.number().int(),
});

export const ErrorResponse = z.object({
	error: z.string(),
});

// --- Part ---

export const PartSchema = z.object({
	id: z.string(),
	title: z.string(),
	sponsorship: z.string().nullable(),
	sortId: z.string(),
});

// --- Paper ---

export const PaperSchema = z.object({
	id: z.string(),
	partId: z.string(),
	title: z.string(),
	sortId: z.string(),
	labels: z.array(z.string()).nullable(),
});

// --- Section ---

export const SectionSchema = z.object({
	id: z.string(),
	paperId: z.string(),
	sectionId: z.string(),
	title: z.string().nullable(),
	globalId: z.string(),
	sortId: z.string(),
});

// --- Audio variant ---

const AudioVariantSchema = z.object({
	format: z.string(),
	url: z.string(),
});

const AudioSchema = z
	.record(
		z.string(),
		z.record(z.string(), AudioVariantSchema),
	)
	.nullable();

// --- Paragraph Entity (inline on paragraph when include=entities) ---

export const ParagraphEntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["being", "place", "order", "race", "religion", "concept"]),
});

// --- Paragraph ---

export const ParagraphSchema = z.object({
	id: z.string(),
	standardReferenceId: z.string(),
	sortId: z.string(),
	paperId: z.string(),
	sectionId: z.string().nullable(),
	partId: z.string(),
	paperTitle: z.string(),
	sectionTitle: z.string().nullable(),
	paragraphId: z.string(),
	text: z.string(),
	htmlText: z.string(),
	labels: z.array(z.string()).nullable(),
	audio: AudioSchema,
	entities: z.array(ParagraphEntitySchema).optional(),
});

// --- TOC ---

export const TocPaperSchema = z.object({
	id: z.string(),
	title: z.string(),
	labels: z.array(z.string()).nullable(),
});

export const TocPartSchema = z.object({
	id: z.string(),
	title: z.string(),
	sponsorship: z.string().nullable(),
	papers: z.array(TocPaperSchema),
});

export const TocResponse = z.object({
	data: z.object({
		parts: z.array(TocPartSchema),
	}),
});

// --- Papers list ---

export const PapersListResponse = z.object({
	data: z.array(PaperSchema),
});

// --- Single paper with paragraphs ---

export const PaperDetailResponse = z.object({
	data: z.object({
		paper: PaperSchema,
		paragraphs: z.array(ParagraphSchema),
	}),
});

// --- Sections ---

export const SectionsResponse = z.object({
	data: z.array(SectionSchema),
});

// --- Paragraph ---

export const ParagraphResponse = z.object({
	data: ParagraphSchema,
});

// --- Paragraph context ---

export const ParagraphContextResponse = z.object({
	data: z.object({
		target: ParagraphSchema,
		before: z.array(ParagraphSchema),
		after: z.array(ParagraphSchema),
	}),
});

// --- Search ---

export const SearchRequest = z.object({
	q: z.string().min(1).max(500),
	page: z.number().int().min(0).default(0),
	limit: z.number().int().min(1).max(100).default(20),
	paperId: z.string().optional(),
	partId: z.string().optional(),
	type: z.enum(["phrase", "and", "or"]).default("and"),
	include: z.string().optional(),
});

export const SearchResultSchema = ParagraphSchema.extend({
	rank: z.number(),
});

export const SearchResponse = z.object({
	data: z.array(SearchResultSchema),
	meta: PaginationMeta,
});

// --- Semantic Search ---

export const SemanticSearchRequest = z.object({
	q: z.string().min(1).max(500),
	page: z.number().int().min(0).default(0),
	limit: z.number().int().min(1).max(100).default(20),
	paperId: z.string().optional(),
	partId: z.string().optional(),
	include: z.string().optional(),
});

export const SemanticSearchResultSchema = ParagraphSchema.extend({
	similarity: z.number(),
});

export const SemanticSearchResponse = z.object({
	data: z.array(SemanticSearchResultSchema),
	meta: PaginationMeta,
});

// --- Audio ---

export const AudioResponse = z.object({
	data: z.object({
		paragraphId: z.string(),
		audio: AudioSchema,
	}),
});

// --- Param schemas ---

export const PaperIdParam = z.object({
	id: z.string(),
});

export const ParagraphRefParam = z.object({
	ref: z.string(),
});

export const AudioParam = z.object({
	paragraphId: z.string(),
});

export const ContextQuery = z.object({
	window: z.coerce.number().int().min(1).max(10).default(2),
	include: z.string().optional(),
});

export const IncludeQuery = z.object({
	include: z.string().optional(),
});

// --- Entity ---

export const EntitySchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(["being", "place", "order", "race", "religion", "concept"]),
	aliases: z.array(z.string()).nullable(),
	description: z.string().nullable(),
	seeAlso: z.array(z.string()).nullable(),
	citationCount: z.number().int(),
});

export const EntitiesListQuery = z.object({
	page: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(100).default(20),
	type: z.enum(["being", "place", "order", "race", "religion", "concept"]).optional(),
	q: z.string().max(200).optional(),
});

export const EntityIdParam = z.object({ id: z.string() });

export const EntityParagraphsQuery = z.object({
	page: z.coerce.number().int().min(0).default(0),
	limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const EntitiesListResponse = z.object({
	data: z.array(EntitySchema),
	meta: PaginationMeta,
});

export const EntityDetailResponse = z.object({ data: EntitySchema });

export const EntityParagraphsResponse = z.object({
	data: z.array(ParagraphSchema),
	meta: PaginationMeta,
});
