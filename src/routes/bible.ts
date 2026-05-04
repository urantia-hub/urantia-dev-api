import { createRoute } from "@hono/zod-openapi";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import {
	bibleChunks,
	bibleParallels,
	bibleVerses,
	paragraphs,
} from "../db/schema.ts";
import { createApp } from "../lib/app.ts";
import {
	BIBLE_BOOKS,
	formatBibleReference,
	resolveBibleBook,
} from "../lib/bible-canonicalizer.ts";
import { problemJson } from "../lib/errors.ts";
import {
	BibleBookParam,
	BibleBookResponse,
	BibleBooksResponse,
	BibleChapterParam,
	BibleChapterResponse,
	BibleVerseParagraphsResponse,
	BibleVerseParam,
	BibleVerseResponse,
	ErrorResponse,
} from "../validators/schemas.ts";

export const bibleRoute = createApp();

// GET /bible/books — full list with chapter+verse counts
const listBooksRoute = createRoute({
	operationId: "listBibleBooks",
	method: "get",
	path: "/books",
	tags: ["Bible"],
	summary: "List all 81 Bible books",
	description:
		"Returns metadata for every book in the World English Bible (eng-web), including chapter and verse counts. Books are returned in canonical ecumenical order: 39 Old Testament, 15 deuterocanonical, 27 New Testament.",
	responses: {
		200: {
			description: "List of all Bible books",
			content: { "application/json": { schema: BibleBooksResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

bibleRoute.openapi(listBooksRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);

	// Aggregate per-book chapter and verse counts in a single query.
	const rows = await db
		.select({
			bookCode: bibleVerses.bookCode,
			chapterCount: sql<number>`count(distinct ${bibleVerses.chapter})`,
			verseCount: sql<number>`count(*)::int`,
		})
		.from(bibleVerses)
		.groupBy(bibleVerses.bookCode);

	const counts = new Map(rows.map((r) => [r.bookCode, r]));

	// Merge with canonical metadata so the response order is deterministic
	// and includes books even if (somehow) they have zero verses.
	const data = BIBLE_BOOKS.map((b) => {
		const c = counts.get(b.osis);
		return {
			bookCode: b.osis,
			bookName: b.name,
			fullName: b.fullName,
			abbr: b.abbr,
			bookOrder: b.order,
			canon: b.canon,
			chapterCount: Number(c?.chapterCount ?? 0),
			verseCount: Number(c?.verseCount ?? 0),
		};
	});

	return c.json({ data }, 200);
});

// GET /bible/{bookCode} — single book metadata
const getBookRoute = createRoute({
	operationId: "getBibleBook",
	method: "get",
	path: "/{bookCode}",
	tags: ["Bible"],
	summary: "Get a Bible book's metadata",
	description:
		"Returns metadata for a single book including chapter and verse counts. Accepts OSIS codes (e.g., `Gen`), USFM codes (`GEN`), full names (`Genesis`), and common aliases (`genesis`, `1-maccabees`).",
	request: { params: BibleBookParam },
	responses: {
		200: {
			description: "Book metadata",
			content: { "application/json": { schema: BibleBookResponse } },
		},
		404: {
			description: "Book not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

bibleRoute.openapi(getBookRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { bookCode } = c.req.valid("param");

	const meta = resolveBibleBook(bookCode);
	if (!meta) {
		return problemJson(c, 404, `Bible book "${bookCode}" not found`);
	}

	const counts = await db
		.select({
			chapterCount: sql<number>`count(distinct ${bibleVerses.chapter})`,
			verseCount: sql<number>`count(*)::int`,
		})
		.from(bibleVerses)
		.where(eq(bibleVerses.bookCode, meta.osis));

	return c.json(
		{
			data: {
				bookCode: meta.osis,
				bookName: meta.name,
				fullName: meta.fullName,
				abbr: meta.abbr,
				bookOrder: meta.order,
				canon: meta.canon,
				chapterCount: Number(counts[0]?.chapterCount ?? 0),
				verseCount: Number(counts[0]?.verseCount ?? 0),
			},
		},
		200,
	);
});

// GET /bible/{bookCode}/{chapter} — all verses in chapter
const getChapterRoute = createRoute({
	operationId: "getBibleChapter",
	method: "get",
	path: "/{bookCode}/{chapter}",
	tags: ["Bible"],
	summary: "Get all verses in a Bible chapter",
	description:
		"Returns every verse in the requested chapter, ordered by verse number. Accepts OSIS, USFM, full name, or alias for `bookCode`.",
	request: { params: BibleChapterParam },
	responses: {
		200: {
			description: "Chapter with all verses",
			content: { "application/json": { schema: BibleChapterResponse } },
		},
		404: {
			description: "Book or chapter not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

bibleRoute.openapi(getChapterRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { bookCode, chapter } = c.req.valid("param");

	const meta = resolveBibleBook(bookCode);
	if (!meta) {
		return problemJson(c, 404, `Bible book "${bookCode}" not found`);
	}

	const rows = await db
		.select()
		.from(bibleVerses)
		.where(and(eq(bibleVerses.bookCode, meta.osis), eq(bibleVerses.chapter, chapter)))
		.orderBy(bibleVerses.verse);

	if (rows.length === 0) {
		return problemJson(
			c,
			404,
			`${meta.name} has no chapter ${chapter}`,
		);
	}

	const verses = rows.map((r) => ({
		id: r.id,
		reference: formatBibleReference(r.bookCode, r.chapter, r.verse) ?? `${r.bookName} ${r.chapter}:${r.verse}`,
		bookCode: r.bookCode,
		bookName: r.bookName,
		bookOrder: r.bookOrder,
		canon: r.canon as "ot" | "deuterocanon" | "nt",
		chapter: r.chapter,
		verse: r.verse,
		text: r.text,
		translation: r.translation,
	}));

	return c.json(
		{
			data: {
				bookCode: meta.osis,
				bookName: meta.name,
				canon: meta.canon,
				chapter,
				verses,
			},
		},
		200,
	);
});

// GET /bible/{bookCode}/{chapter}/{verse} — single verse
const getVerseRoute = createRoute({
	operationId: "getBibleVerse",
	method: "get",
	path: "/{bookCode}/{chapter}/{verse}",
	tags: ["Bible"],
	summary: "Get a single Bible verse",
	description:
		"Returns one verse from the World English Bible (eng-web). Accepts OSIS, USFM, full name, or alias for `bookCode`.",
	request: { params: BibleVerseParam },
	responses: {
		200: {
			description: "Single verse",
			content: { "application/json": { schema: BibleVerseResponse } },
		},
		404: {
			description: "Verse not found",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

bibleRoute.openapi(getVerseRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { bookCode, chapter, verse } = c.req.valid("param");

	const meta = resolveBibleBook(bookCode);
	if (!meta) {
		return problemJson(c, 404, `Bible book "${bookCode}" not found`);
	}

	const rows = await db
		.select()
		.from(bibleVerses)
		.where(
			and(
				eq(bibleVerses.bookCode, meta.osis),
				eq(bibleVerses.chapter, chapter),
				eq(bibleVerses.verse, verse),
			),
		)
		.limit(1);

	const row = rows[0];
	if (!row) {
		return problemJson(
			c,
			404,
			`${meta.name} ${chapter}:${verse} not found`,
		);
	}

	return c.json(
		{
			data: {
				id: row.id,
				reference: formatBibleReference(row.bookCode, row.chapter, row.verse) ?? `${row.bookName} ${row.chapter}:${row.verse}`,
				bookCode: row.bookCode,
				bookName: row.bookName,
				bookOrder: row.bookOrder,
				canon: row.canon as "ot" | "deuterocanon" | "nt",
				chapter: row.chapter,
				verse: row.verse,
				text: row.text,
				translation: row.translation,
			},
		},
		200,
	);
});

// GET /bible/{bookCode}/{chapter}/{verse}/paragraphs
// Reverse-query: top-10 UB paragraphs semantically nearest to the Bible
// chunk that contains this verse.
const getVerseParagraphsRoute = createRoute({
	operationId: "getBibleVerseParagraphs",
	method: "get",
	path: "/{bookCode}/{chapter}/{verse}/paragraphs",
	tags: ["Bible"],
	summary: "Top-10 UB paragraphs for a Bible verse",
	description:
		"Returns the top 10 Urantia paragraphs whose embeddings are nearest to the Bible chunk containing this verse. Pre-computed at seed time using `text-embedding-3-large` (3072-d) cosine similarity across the entire UB corpus. Each result includes a similarity score (0..1) and rank (1..10).\n\n**These are *semantic* parallels, not curated.** Some matches will be subtly wrong — the embedding model treats surface-level vocabulary as meaning, but the UB uses standard religious terms in nonstandard ways. Treat results as starting points for further reading, not as authoritative parallels.",
	request: { params: BibleVerseParam },
	responses: {
		200: {
			description: "Bible verse with top-10 UB paragraphs",
			content: { "application/json": { schema: BibleVerseParagraphsResponse } },
		},
		404: {
			description: "Verse not found or no parallels computed",
			content: { "application/json": { schema: ErrorResponse } },
		},
		500: {
			description: "Internal server error",
			content: { "application/json": { schema: ErrorResponse } },
		},
	},
});

bibleRoute.openapi(getVerseParagraphsRoute, async (c) => {
	const { db } = getDb(c.env?.HYPERDRIVE);
	const { bookCode, chapter, verse } = c.req.valid("param");

	const meta = resolveBibleBook(bookCode);
	if (!meta) {
		return problemJson(c, 404, `Bible book "${bookCode}" not found`);
	}

	// Find the verse and its containing chunk in one round-trip.
	const verseRows = await db
		.select({
			verseId: bibleVerses.id,
			bookCode: bibleVerses.bookCode,
			bookName: bibleVerses.bookName,
			bookOrder: bibleVerses.bookOrder,
			canon: bibleVerses.canon,
			chapter: bibleVerses.chapter,
			verse: bibleVerses.verse,
			text: bibleVerses.text,
			translation: bibleVerses.translation,
			chunkId: bibleVerses.chunkId,
		})
		.from(bibleVerses)
		.where(
			and(
				eq(bibleVerses.bookCode, meta.osis),
				eq(bibleVerses.chapter, chapter),
				eq(bibleVerses.verse, verse),
			),
		)
		.limit(1);

	const v = verseRows[0];
	if (!v) {
		return problemJson(c, 404, `${meta.name} ${chapter}:${verse} not found`);
	}
	if (!v.chunkId) {
		return problemJson(
			c,
			404,
			`${meta.name} ${chapter}:${verse} has no embedding chunk yet`,
		);
	}

	const chunkRows = await db
		.select({
			id: bibleChunks.id,
			verseStart: bibleChunks.verseStart,
			verseEnd: bibleChunks.verseEnd,
			text: bibleChunks.text,
		})
		.from(bibleChunks)
		.where(eq(bibleChunks.id, v.chunkId))
		.limit(1);
	const chunk = chunkRows[0];
	if (!chunk) {
		return problemJson(c, 404, `Chunk ${v.chunkId} not found`);
	}

	const reference =
		formatBibleReference(v.bookCode, v.chapter, chunk.verseStart) ??
		`${v.bookName} ${v.chapter}:${chunk.verseStart}`;
	const chunkReference =
		chunk.verseEnd === chunk.verseStart
			? reference
			: `${reference}-${chunk.verseEnd}`;

	const top = await db
		.select({
			paragraphId: bibleParallels.paragraphId,
			similarity: bibleParallels.similarity,
			rank: bibleParallels.rank,
			source: bibleParallels.source,
			embeddingModel: bibleParallels.embeddingModel,
			pId: paragraphs.id,
			standardReferenceId: paragraphs.standardReferenceId,
			paperId: paragraphs.paperId,
			paperTitle: paragraphs.paperTitle,
			sectionTitle: paragraphs.sectionTitle,
			text: paragraphs.text,
		})
		.from(bibleParallels)
		.innerJoin(paragraphs, eq(bibleParallels.paragraphId, paragraphs.id))
		.where(
			and(
				eq(bibleParallels.bibleChunkId, v.chunkId),
				eq(bibleParallels.direction, "bible_to_ub"),
			),
		)
		.orderBy(asc(bibleParallels.rank));

	return c.json(
		{
			data: {
				verse: {
					id: v.verseId,
					reference:
						formatBibleReference(v.bookCode, v.chapter, v.verse) ??
						`${v.bookName} ${v.chapter}:${v.verse}`,
					bookCode: v.bookCode,
					bookName: v.bookName,
					bookOrder: v.bookOrder,
					canon: v.canon as "ot" | "deuterocanon" | "nt",
					chapter: v.chapter,
					verse: v.verse,
					text: v.text,
					translation: v.translation,
				},
				chunk: {
					id: chunk.id,
					reference: chunkReference,
					verseStart: chunk.verseStart,
					verseEnd: chunk.verseEnd,
					text: chunk.text,
				},
				paragraphs: top.map((p) => ({
					id: p.pId,
					standardReferenceId: p.standardReferenceId,
					paperId: p.paperId,
					paperTitle: p.paperTitle,
					sectionTitle: p.sectionTitle,
					text: p.text,
					similarity: p.similarity,
					rank: p.rank,
					source: p.source,
					embeddingModel: p.embeddingModel,
				})),
			},
		},
		200,
	);
});
