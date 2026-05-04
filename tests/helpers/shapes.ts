import { expect } from "bun:test";

const PARAGRAPH_KEYS = [
	"audio",
	"htmlText",
	"id",
	"labels",
	"paperId",
	"paperTitle",
	"paragraphId",
	"partId",
	"sectionId",
	"sectionTitle",
	"sortId",
	"standardReferenceId",
	"text",
];

const PAPER_KEYS = ["id", "labels", "partId", "sortId", "title", "video"];
const PAPER_WITH_ENTITIES_KEYS = [...PAPER_KEYS, "topEntities"].sort();

const TOP_ENTITY_KEYS = ["count", "id", "name", "type"];

const SECTION_KEYS = [
	"globalId",
	"id",
	"paperId",
	"sectionId",
	"sortId",
	"title",
];

const ENTITY_KEYS = [
	"aliases",
	"citationCount",
	"description",
	"id",
	"name",
	"seeAlso",
	"type",
];

const META_KEYS = ["limit", "page", "total", "totalPages"];

const BIBLE_VERSE_KEYS = [
	"bookCode",
	"bookName",
	"bookOrder",
	"canon",
	"chapter",
	"id",
	"reference",
	"text",
	"translation",
	"verse",
];

const BIBLE_BOOK_KEYS = [
	"abbr",
	"bookCode",
	"bookName",
	"bookOrder",
	"canon",
	"chapterCount",
	"fullName",
	"verseCount",
];

const BIBLE_CHAPTER_KEYS = ["bookCode", "bookName", "canon", "chapter", "verses"];

export function assertBibleVerseShape(v: Record<string, unknown>) {
	expect(Object.keys(v).sort()).toEqual(BIBLE_VERSE_KEYS);
}

export function assertBibleBookShape(b: Record<string, unknown>) {
	expect(Object.keys(b).sort()).toEqual(BIBLE_BOOK_KEYS);
}

export function assertBibleChapterShape(c: Record<string, unknown>) {
	expect(Object.keys(c).sort()).toEqual(BIBLE_CHAPTER_KEYS);
}

export function assertParagraphShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PARAGRAPH_KEYS);
}

export function assertPaperShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PAPER_KEYS);
}

export function assertPaperWithEntitiesShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PAPER_WITH_ENTITIES_KEYS);
}

export function assertTopEntityShape(e: Record<string, unknown>) {
	expect(Object.keys(e).sort()).toEqual(TOP_ENTITY_KEYS);
}

export function assertSectionShape(s: Record<string, unknown>) {
	expect(Object.keys(s).sort()).toEqual(SECTION_KEYS);
}

export function assertSearchResultShape(r: Record<string, unknown>) {
	expect(Object.keys(r).sort()).toEqual([...PARAGRAPH_KEYS, "rank"].sort());
}

export function assertSemanticResultShape(r: Record<string, unknown>) {
	expect(Object.keys(r).sort()).toEqual(
		[...PARAGRAPH_KEYS, "similarity"].sort(),
	);
}

export function assertEntityShape(e: Record<string, unknown>) {
	expect(Object.keys(e).sort()).toEqual(ENTITY_KEYS);
}

export function assertMetaShape(m: Record<string, unknown>) {
	expect(Object.keys(m).sort()).toEqual(META_KEYS);
}

const PROBLEM_KEYS = ["detail", "status", "title", "type"];

export function assertProblemShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PROBLEM_KEYS);
	expect(typeof p.type).toBe("string");
	expect(typeof p.title).toBe("string");
	expect(typeof p.status).toBe("number");
	expect(typeof p.detail).toBe("string");
}
