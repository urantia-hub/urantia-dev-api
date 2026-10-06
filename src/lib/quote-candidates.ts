import { sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { paragraphs } from "../db/schema.ts";
import { resolveParagraphRef } from "./paragraph-lookup.ts";

export type Candidate = {
	standardReferenceId: string;
	paperId: string;
	paperTitle: string;
	sectionTitle: string | null;
	text: string;
};

export type CandidateSource = {
	/** Paragraphs that share the most words with the quote, best first. */
	search(query: string, limit: number): Promise<Candidate[]>;
	/** One paragraph by any reference format, or null. */
	byRef(ref: string): Promise<Candidate | null>;
};

const fields = {
	standardReferenceId: paragraphs.standardReferenceId,
	paperId: paragraphs.paperId,
	paperTitle: paragraphs.paperTitle,
	sectionTitle: paragraphs.sectionTitle,
	text: paragraphs.text,
};

export function databaseCandidates(hyperdrive: Hyperdrive | undefined): CandidateSource {
	const { db } = getDb(hyperdrive);
	return {
		async search(query, limit) {
			const tsQuery = sql`websearch_to_tsquery('english', ${query})`;
			return db
				.select(fields)
				.from(paragraphs)
				.where(sql`search_vector @@ ${tsQuery}`)
				.orderBy(sql`ts_rank_cd(search_vector, ${tsQuery}) DESC`)
				.limit(limit);
		},
		async byRef(ref) {
			const found = await resolveParagraphRef(db, ref);
			if (!found) return null;
			const p = found.paragraph;
			return {
				standardReferenceId: p.standardReferenceId,
				paperId: p.paperId,
				paperTitle: p.paperTitle,
				sectionTitle: p.sectionTitle,
				text: p.text,
			};
		},
	};
}
