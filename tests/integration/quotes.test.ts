import { describe, expect, it } from "bun:test";
import type { Candidate, CandidateSource } from "../../src/lib/quote-candidates.ts";
import { createQuotesRoute } from "../../src/routes/quotes.ts";

const P251: Candidate = {
	standardReferenceId: "2:5.1",
	paperId: "2",
	paperTitle: "The Nature of God",
	sectionTitle: "The Love of God",
	text: "The Father loves us sufficiently to bestow his life upon us.",
};
const OTHER: Candidate = {
	standardReferenceId: "99:7.3",
	paperId: "99",
	paperTitle: "The Social Problems of Religion",
	sectionTitle: null,
	text: "Religion inspires man to live courageously and joyfully on the face of the earth.",
};

function source(found: Candidate[], all: Candidate[] = found): CandidateSource {
	return {
		search: async () => found,
		byRef: async (ref) => all.find((c) => c.standardReferenceId === ref) ?? null,
	};
}

async function verify(src: CandidateSource, body: object) {
	const app = createQuotesRoute(() => src);
	const res = await app.request("/verify", {
		method: "POST",
		headers: { "Content-Type": "application/json", "cf-connecting-ip": "quotes-test" },
		body: JSON.stringify(body),
	});
	return { status: res.status, body: (await res.json()) as { data: Record<string, unknown> } & Record<string, unknown> };
}

describe("POST /quotes/verify", () => {
	it("returns exact with the reference and the true text", async () => {
		const { status, body } = await verify(source([OTHER, P251]), {
			text: "the father loves us sufficiently to bestow his life upon us",
		});
		expect(status).toBe(200);
		expect(body.data.verdict).toBe("exact");
		expect(body.data.match).toMatchObject({ reference: "2:5.1", text: P251.text.slice(0, -1) });
		expect(body.data.claimedReference).toBeNull();
	});

	it("returns close with the differences", async () => {
		const { body } = await verify(source([P251]), { text: "The Father loves us enough to bestow his life upon us" });
		expect(body.data.verdict).toBe("close");
		expect((body.data.match as { differences: unknown }).differences).toEqual([
			{ quote: "enough", text: "sufficiently" },
		]);
	});

	it("checks a claimed reference that search did not return, and reports a wrong one", async () => {
		const quote = "Religion inspires man to live courageously and joyfully on the face of the earth";
		const right = await verify(source([], [OTHER]), { text: quote, ref: "99:7.3" });
		expect(right.body.data.verdict).toBe("exact");
		expect(right.body.data.claimedReference).toEqual({ ref: "99:7.3", exists: true, verdict: "exact" });

		const wrong = await verify(source([OTHER], [OTHER, P251]), { text: quote, ref: "2:5.1" });
		expect(wrong.body.data.verdict).toBe("exact");
		expect((wrong.body.data.match as { reference: string }).reference).toBe("99:7.3");
		expect(wrong.body.data.claimedReference).toEqual({ ref: "2:5.1", exists: true, verdict: "not_found" });

		const missing = await verify(source([OTHER]), { text: quote, ref: "250:1.1" });
		expect(missing.body.data.claimedReference).toEqual({ ref: "250:1.1", exists: false, verdict: null });
	});

	it("returns not_found with no match for an invented quote", async () => {
		const { body } = await verify(source([P251, OTHER]), {
			text: "Intelligent courage is the supreme valor of a truly moral being",
		});
		expect(body.data.verdict).toBe("not_found");
		expect(body.data.match).toBeNull();
		expect(body.data.alsoFoundAt).toEqual([]);
	});

	it("lists other exact references for a repeated passage", async () => {
		const copy = { ...P251, standardReferenceId: "3:1.1" };
		const { body } = await verify(source([P251, copy]), {
			text: "loves us sufficiently to bestow his life",
		});
		expect(body.data.alsoFoundAt).toEqual(["3:1.1"]);
	});

	it("rejects a quote under 4 words, and an empty body", async () => {
		expect((await verify(source([P251]), { text: "God is love" })).status).toBe(400);
		expect((await verify(source([P251]), {})).status).toBe(400);
	});
});
