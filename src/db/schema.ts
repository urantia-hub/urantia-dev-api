import {
	customType,
	index,
	integer,
	jsonb as pgJsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

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

type VideoVariant = { mp4: string; thumbnail: string; duration: number };
type VideoData = Record<string, VideoVariant> | null;

const videoJsonb = customType<{ data: VideoData }>({
	dataType() {
		return "jsonb";
	},
	toDriver(value: VideoData) {
		return value === null ? null : JSON.stringify(value);
	},
	fromDriver(value: unknown) {
		if (typeof value === "string") return JSON.parse(value) as VideoData;
		return value as VideoData;
	},
});

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
		video: videoJsonb("video"),
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

// --- paragraph_translations ---
export const paragraphTranslations = pgTable(
	"paragraph_translations",
	{
		id: text("id").primaryKey(), // "{paragraphId}:{lang}:v{version}"
		paragraphId: text("paragraph_id")
			.notNull()
			.references(() => paragraphs.id),
		language: text("language").notNull(), // ISO 639-1: "es", "fr", "pt", "de", "ko"
		version: integer("version").notNull().default(1),
		text: text("text").notNull(),
		htmlText: text("html_text").notNull(),
		source: text("source").notNull().default("urantia.dev"),
		confidence: text("confidence"), // "high" | "medium" | "needs_review"
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("pt_paragraph_lang_version_idx").on(
			t.paragraphId,
			t.language,
			t.version,
		),
		index("pt_language_idx").on(t.language),
		index("pt_paragraph_id_idx").on(t.paragraphId),
	],
);

// --- title_translations ---
export const titleTranslations = pgTable(
	"title_translations",
	{
		id: text("id").primaryKey(), // "{sourceType}:{sourceId}:{lang}:v{version}"
		sourceType: text("source_type").notNull(), // "paper" | "section"
		sourceId: text("source_id").notNull(), // paper.id or section.id
		language: text("language").notNull(),
		version: integer("version").notNull().default(1),
		title: text("title").notNull(),
		source: text("source").notNull().default("urantia.dev"),
		confidence: text("confidence"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("tt_type_source_lang_version_idx").on(
			t.sourceType,
			t.sourceId,
			t.language,
			t.version,
		),
		index("tt_language_idx").on(t.language),
		index("tt_source_type_id_idx").on(t.sourceType, t.sourceId),
	],
);

// ============================================================
// Auth layer tables (unified auth for the Urantia ecosystem)
// ============================================================

// --- users (synced lazily from Supabase Auth) ---
export const users = pgTable("users", {
	id: uuid("id").primaryKey(), // matches Supabase Auth user ID
	email: text("email").unique(),
	name: text("name"),
	avatarUrl: text("avatar_url"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- bookmarks (paragraph-level, one per user + paragraph + app) ---
export const bookmarks = pgTable(
	"bookmarks",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		appId: text("app_id").notNull().default("default"), // which app created this
		paragraphId: text("paragraph_id").notNull(), // globalId e.g. "1:2.0.1"
		paperId: text("paper_id").notNull(), // denormalized
		paperSectionId: text("paper_section_id").notNull(), // denormalized
		paperSectionParagraphId: text("paper_section_paragraph_id").notNull(), // denormalized
		category: text("category"), // user-defined label, nullable
		visibility: text("visibility").notNull().default("private"), // private | public | group (future)
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("bookmarks_user_paragraph_app_idx").on(t.userId, t.paragraphId, t.appId),
		index("bookmarks_user_id_idx").on(t.userId),
		index("bookmarks_user_paper_idx").on(t.userId, t.paperId),
	],
);

// --- notes (paragraph-level, multiple per paragraph allowed) ---
export const notes = pgTable(
	"notes",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		appId: text("app_id").notNull().default("default"),
		paragraphId: text("paragraph_id").notNull(),
		paperId: text("paper_id").notNull(),
		paperSectionId: text("paper_section_id").notNull(),
		paperSectionParagraphId: text("paper_section_paragraph_id").notNull(),
		text: text("text").notNull(),
		format: text("format").notNull().default("plain"), // 'plain' or 'markdown'
		visibility: text("visibility").notNull().default("private"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		index("notes_user_id_idx").on(t.userId),
		index("notes_user_paper_idx").on(t.userId, t.paperId),
		index("notes_user_paragraph_idx").on(t.userId, t.paragraphId),
	],
);

// --- reading_progress (paragraph-level, one per user + paragraph + app) ---
export const readingProgress = pgTable(
	"reading_progress",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		appId: text("app_id").notNull().default("default"),
		paragraphId: text("paragraph_id").notNull(),
		paperId: text("paper_id").notNull(),
		paperSectionId: text("paper_section_id").notNull(),
		paperSectionParagraphId: text("paper_section_paragraph_id").notNull(),
		readAt: timestamp("read_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("reading_progress_user_paragraph_app_idx").on(t.userId, t.paragraphId, t.appId),
		index("reading_progress_user_id_idx").on(t.userId),
		index("reading_progress_user_paper_idx").on(t.userId, t.paperId),
	],
);

// --- user_preferences (flexible JSONB per user) ---
export const userPreferences = pgTable("user_preferences", {
	userId: uuid("user_id")
		.primaryKey()
		.references(() => users.id, { onDelete: "cascade" }),
	preferences: pgJsonb("preferences").default({}).notNull(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- apps (OAuth client registry) ---
export const apps = pgTable("apps", {
	id: text("id").primaryKey(), // human-readable slug e.g. "urantiahub"
	name: text("name").notNull(),
	secretHash: text("secret_hash").notNull(),
	redirectUris: text("redirect_uris").array().notNull(),
	scopes: text("scopes").array().notNull(),
	ownerId: uuid("owner_id").references(() => users.id),
	logoUrl: text("logo_url"),
	primaryColor: text("primary_color"),
	accentColor: text("accent_color"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- user_consents (OAuth consent grants per user per app) ---
export const userConsents = pgTable(
	"user_consents",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		appId: text("app_id")
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		scopes: text("scopes").array().notNull(),
		grantedAt: timestamp("granted_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("user_consents_user_app_idx").on(t.userId, t.appId),
	],
);

// --- app_user_data (sandboxed key-value per app per user) ---
export const appUserData = pgTable(
	"app_user_data",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		appId: text("app_id")
			.notNull()
			.references(() => apps.id, { onDelete: "cascade" }),
		userId: uuid("user_id")
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		value: pgJsonb("value").notNull(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(t) => [
		uniqueIndex("app_user_data_app_user_key_idx").on(t.appId, t.userId, t.key),
		index("app_user_data_app_user_idx").on(t.appId, t.userId),
	],
);

// --- auth_codes (short-lived OAuth authorization codes) ---
export const authCodes = pgTable("auth_codes", {
	code: text("code").primaryKey(),
	appId: text("app_id")
		.notNull()
		.references(() => apps.id, { onDelete: "cascade" }),
	userId: uuid("user_id")
		.notNull()
		.references(() => users.id, { onDelete: "cascade" }),
	scopes: text("scopes").array().notNull(),
	codeChallenge: text("code_challenge"), // PKCE
	redirectUri: text("redirect_uri").notNull(),
	expiresAt: timestamp("expires_at").notNull(),
});
