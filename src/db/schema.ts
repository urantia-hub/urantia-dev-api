import { customType, index, integer, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
	dataType() {
		return "tsvector";
	},
});

const vector = customType<{ data: number[] }>({
	dataType() {
		return "vector(1536)";
	},
});

type AudioVariant = { format: string; url: string };
type AudioData = Record<string, Record<string, AudioVariant>> | null;

const jsonb = customType<{ data: AudioData }>({
	dataType() {
		return "jsonb";
	},
	toDriver(value: AudioData) {
		return value === null ? null : JSON.stringify(value);
	},
	fromDriver(value: unknown) {
		if (typeof value === "string") return JSON.parse(value) as AudioData;
		return value as AudioData;
	},
});

// --- parts ---
export const parts = pgTable("parts", {
	id: text("id").primaryKey(),
	title: text("title").notNull(),
	sponsorship: text("sponsorship"),
	sortId: text("sort_id").notNull(),
});

// --- papers ---
export const papers = pgTable(
	"papers",
	{
		id: text("id").primaryKey(),
		partId: text("part_id")
			.notNull()
			.references(() => parts.id),
		title: text("title").notNull(),
		globalId: text("global_id").notNull(),
		sortId: text("sort_id").notNull(),
		labels: text("labels").array(),
	},
	(t) => [index("papers_part_id_idx").on(t.partId)],
);

// --- sections ---
export const sections = pgTable(
	"sections",
	{
		id: text("id").primaryKey(),
		paperId: text("paper_id")
			.notNull()
			.references(() => papers.id),
		sectionId: text("section_id").notNull(),
		title: text("title"),
		globalId: text("global_id").notNull(),
		sortId: text("sort_id").notNull(),
	},
	(t) => [index("sections_paper_id_idx").on(t.paperId)],
);

// --- paragraphs ---
export const paragraphs = pgTable(
	"paragraphs",
	{
		id: text("id").primaryKey(),
		globalId: text("global_id").notNull().unique(),
		standardReferenceId: text("standard_reference_id").notNull(),
		paperSectionParagraphId: text("paper_section_paragraph_id").notNull(),
		sortId: text("sort_id").notNull(),

		paperId: text("paper_id")
			.notNull()
			.references(() => papers.id),
		sectionId: text("section_id").references(() => sections.id),
		partId: text("part_id")
			.notNull()
			.references(() => parts.id),

		paperTitle: text("paper_title").notNull(),
		sectionTitle: text("section_title"),
		paragraphId: text("paragraph_id").notNull(),
		language: text("language").notNull().default("eng"),

		text: text("text").notNull(),
		htmlText: text("html_text").notNull(),

		labels: text("labels").array(),

		// Full-text search — populated via SQL generated column (see setup-fts.sql)
		searchVector: tsvector("search_vector"),

		// Semantic search — populated later via generate-embeddings script
		embedding: vector("embedding"),

		audio: jsonb("audio"),
	},
	(t) => [
		index("paragraphs_paper_id_idx").on(t.paperId),
		index("paragraphs_section_id_idx").on(t.sectionId),
		index("paragraphs_sort_id_idx").on(t.sortId),
		index("paragraphs_std_ref_idx").on(t.standardReferenceId),
		index("paragraphs_psp_id_idx").on(t.paperSectionParagraphId),
	],
);

// --- entities ---
export const entities = pgTable(
	"entities",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		type: text("type").notNull(),
		aliases: text("aliases").array(),
		description: text("description"),
		seeAlso: text("see_also").array(),
		citationCount: integer("citation_count").notNull(),
	},
	(t) => [index("entities_type_idx").on(t.type)],
);

// --- entity_translations ---
export const entityTranslations = pgTable(
	"entity_translations",
	{
		id: text("id").primaryKey(), // "{entityId}:{lang}:{source}:v{version}"
		entityId: text("entity_id")
			.notNull()
			.references(() => entities.id),
		language: text("language").notNull(), // ISO 639-1: "nl", "es", "fr"
		source: text("source").notNull(), // "foundation" | "urantia.dev"
		version: integer("version").notNull().default(1),
		name: text("name").notNull(),
		aliases: text("aliases").array(),
		description: text("description"),
		confidence: text("confidence"), // "high" | "medium" | "needs_manual"
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		index("et_entity_lang_idx").on(t.entityId, t.language),
		index("et_lang_source_idx").on(t.language, t.source),
		uniqueIndex("et_entity_lang_source_version_idx").on(
			t.entityId,
			t.language,
			t.source,
			t.version,
		),
	],
);

// --- paragraph_entities (junction) ---
export const paragraphEntities = pgTable(
	"paragraph_entities",
	{
		paragraphId: text("paragraph_id")
			.notNull()
			.references(() => paragraphs.id),
		entityId: text("entity_id")
			.notNull()
			.references(() => entities.id),
	},
	(t) => [
		index("pe_paragraph_id_idx").on(t.paragraphId),
		index("pe_entity_id_idx").on(t.entityId),
	],
);
