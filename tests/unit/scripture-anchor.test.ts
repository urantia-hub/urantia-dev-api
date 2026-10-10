import { describe, expect, it } from "bun:test";
import { findAnchor, pageText } from "../../scripts/scriptures/anchor.ts";

const page = pageText(`<html><head><style>p{}</style></head><body>
<p>P: Say: Who is Lord of the heavens and the earth? Say: Allah.</p>
<p>Y: Lord of the heavens and of the earth, and of all between them.</p>
<p>P: Lord of the heavens and the earth and all that is between them! Therefor, worship thou Him and be thou steadfast in His service.</p>
<p>Let no man think lightly of evil, saying in his heart, It will not come nigh unto me.</p>
<p>Let no man think lightly of good, saying in his heart, It will not come nigh unto me.</p>
<p>The Master said, &quot;Is it not <i>pleasant</i> to learn&nbsp;with a constant perseverance?&quot;</p>
<p>First half of a verse</p><p>second half of a verse here</p>
</body></html>`);

describe("the words that take a browser to one passage", () => {
	it("are the first words that are in one place of the page only", () => {
		expect(
			findAnchor(
				page,
				"Lord of the heavens and the earth and all that is between them! Therefor, worship thou Him and be thou steadfast in His service.",
			),
		).toBe("Lord of the heavens and the earth and");
	});

	it("take more words when the first words are the same as in another passage", () => {
		expect(
			findAnchor(
				page,
				"Let no man think lightly of good, saying in his heart, It will not come nigh unto me.",
			),
		).toBe("Let no man think lightly of good,");
	});

	it("count a match in any case, as a browser does", () => {
		expect(
			findAnchor(
				pageText(
					"<p>LORD OF THE HEAVENS AND THE EARTH AND ALL</p><p>Lord of the heavens and the earth and all</p>",
				),
				"Lord of the heavens and the earth and all",
			),
		).toBeNull();
	});

	it("have no quote mark, so that the form of the mark on the page does not matter", () => {
		expect(
			findAnchor(
				page,
				'The Master said, "Is it not pleasant to learn with a constant perseverance?"',
			),
		).toBe("it not pleasant to");
	});

	it("do not go across two blocks of the page: a browser finds no words there", () => {
		expect(findAnchor(page, "half of a verse second half of a verse here")).toBe(
			"second half of a",
		);
	});

	it("are null for a passage that is not on the page, or that has no part of its own", () => {
		expect(findAnchor(page, "This passage is nowhere on the page at all, in any form.")).toBeNull();
		expect(findAnchor(page, "It will not come nigh unto me.")).toBeNull();
	});
});
