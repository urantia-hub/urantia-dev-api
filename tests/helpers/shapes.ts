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

export function assertParagraphShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PARAGRAPH_KEYS);
}

export function assertPaperShape(p: Record<string, unknown>) {
	expect(Object.keys(p).sort()).toEqual(PAPER_KEYS);
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
