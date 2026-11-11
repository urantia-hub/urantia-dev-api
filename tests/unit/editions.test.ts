import { describe, expect, test } from "bun:test";
import scan from "../../data/editions/scan-check.json";
import {
	chooseEdition,
	DEFAULT_EDITION,
	EDITIONS,
	editionInfo,
	htmlInEdition,
	inEdition,
	resolveEdition,
	textInEdition,
	undoneIn,
	VARIANTS,
	variantsOf,
	withVariants,
} from "../../src/lib/editions.ts";

const ed = (id: string) => {
	const e = resolveEdition(id);
	if (!e) throw new Error(`no edition ${id}`);
	return e;
};

describe("the variants file", () => {
	test("has the 180 rows of the Foundation's adopted list and 1 row from the scan", () => {
		expect(VARIANTS.length).toBe(181);
		expect(
			VARIANTS.filter((v) => v.source.list === null).map((v) => `${v.ref} ${v.foundBy}`),
		).toEqual(["27:6.4 scan"]);
	});

	test("each row has a known kind, a real ref, and two different sides", () => {
		for (const v of VARIANTS) {
			expect(["text", "format", "printing"]).toContain(v.kind);
			expect(v.ref).toMatch(/^\d+:\d+\.\d+$/);
			expect(v.before).not.toBe(v.after);
			expect(v.before.length).toBeGreaterThan(0);
		}
	});

	test("each year is a committee year, or null for the rows that no report lists", () => {
		const years = new Set(VARIANTS.map((v) => v.year));
		for (const y of years) expect([null, 2009, 2015, 2018, 2021, 2024]).toContain(y);
		expect(
			VARIANTS.filter((v) => v.year === null)
				.map((v) => v.ref)
				.sort(),
		).toEqual(["101:3.5", "117:7.4", "187:5.1", "27:6.4", "95:7.1"]);
	});

	test("counts by year match the committee reports", () => {
		const n = (y: number) => VARIANTS.filter((v) => v.year === y).length;
		expect([n(2015), n(2018), n(2021), n(2024)]).toEqual([7, 7, 4, 2]);
	});

	test("the rows that the download does not have are named", () => {
		expect(VARIANTS.filter((v) => !v.inStoredText).map((v) => v.ref)).toEqual([
			"58:1.7",
			"119:8.9",
		]);
	});
});

describe("the scan check", () => {
	test("has one result for each row, in the same order", () => {
		expect(scan.rows.length).toBe(VARIANTS.length);
		scan.rows.forEach((r, i) => {
			expect(r.ref).toBe(VARIANTS[i]?.ref ?? "");
			expect(r.before).toBe(VARIANTS[i]?.before ?? "");
		});
	});

	test("each row matches the 1955 photo, except the two that the photos cannot settle", () => {
		const open = scan.rows.filter((r) => r.result !== "matches").map((r) => `${r.ref} ${r.result}`);
		expect(open).toEqual(["162:7.2 not-settled", "196:3.35 not-checked"]);
	});
});

describe("resolveEdition", () => {
	test("takes the year id, the Foundation number, and the version stamp", () => {
		expect(resolveEdition("srt-2024")?.id).toBe("srt-2024");
		expect(resolveEdition("1.22")?.id).toBe("srt-2024");
		expect(resolveEdition("UF-202412132348")?.id).toBe("srt-2024");
		expect(resolveEdition("21")?.id).toBe("srt-2021");
		expect(resolveEdition(" SRT-2021 ")?.id).toBe("srt-2021");
		expect(resolveEdition("1955")?.id).toBe("1955");
	});

	test("refuses an unknown id", () => {
		expect(resolveEdition("srt-2012")).toBeUndefined();
		expect(resolveEdition("")).toBeUndefined();
	});

	test("the default is the newest edition", () => {
		expect(EDITIONS.at(-1)?.id).toBe(DEFAULT_EDITION);
	});
});

describe("textInEdition", () => {
	const stored98 =
		"the official Roman cult had a roster of more than two-score self-elevated human deities";

	test("the default edition is the stored text", () => {
		for (const v of VARIANTS) expect(undoneIn(v.ref, ed(DEFAULT_EDITION))).toEqual([]);
		expect(textInEdition("98:3.8", stored98, ed("srt-2024"))).toBe(stored98);
	});

	test("an older edition undoes the rows after its year", () => {
		expect(textInEdition("98:3.8", stored98, ed("srt-2021"))).toContain(
			"more than twoscore self-elevated",
		);
		expect(textInEdition("98:3.8", stored98, ed("1955"))).toContain("twoscore");
	});

	test("a row of a year stays in that year's edition", () => {
		const stored =
			"Without the effective functioning of a consciousness sorter and associator there would";
		expect(textInEdition("133:7.9", stored, ed("srt-2024"))).toContain("associator");
		expect(textInEdition("133:7.9", stored, ed("srt-2021"))).toContain("associater");
	});

	test("1955 undoes the 2009 rows; srt-2009 keeps them", () => {
		const stored = "having become forty thousand times as dense as your sun";
		expect(textInEdition("41:4.4", stored, ed("srt-2009"))).toBe(stored);
		expect(textInEdition("41:4.4", stored, ed("1955"))).toBe(
			"having become sixty thousand times as dense as your sun",
		);
	});

	test("format and printing rows never change the plain text", () => {
		for (const v of VARIANTS.filter((x) => x.kind !== "text")) {
			expect(undoneIn(v.ref, ed("1955")).includes(v)).toBe(false);
		}
	});

	test("a paragraph with two rows undoes both", () => {
		const rows = variantsOf("42:6.7").filter((v) => v.kind === "text");
		expect(rows.length).toBe(2);
		const stored = rows.map((v) => v.after).join(" ... ");
		expect(textInEdition("42:6.7", stored, ed("1955"))).toBe(
			rows.map((v) => v.before).join(" ... "),
		);
	});

	test("throws when the stored text does not hold the row's words", () => {
		expect(() => textInEdition("98:3.8", "some other text", ed("1955"))).toThrow();
	});
});

describe("the html of an edition", () => {
	const e1955 = ed("1955");
	test("replaces only the changed part, so the markup stays (57:1.4, 37:8.3)", () => {
		const html =
			'<span class="x"><em>900,000,000,000</em> years ago, the Uversa archives testify, there</span>';
		expect(htmlInEdition("57:1.4", html, e1955)).toBe(
			'<span class="x"><em>900,000,000,000</em> years ago the Uversa archives testify, there</span>',
		);
		const html2 =
			"Andovontia is the name of the tertiary <em>Universe Circuit Supervisor</em> stationed";
		expect(htmlInEdition("37:8.3", html2, e1955)).toBe(
			"Andovontia is the name of the secondary <em>Universe Circuit Supervisor</em> stationed",
		);
	});
	test("leaves the html of the default edition as it is", () => {
		expect(htmlInEdition("57:1.4", "<em>a</em>", ed(DEFAULT_EDITION))).toBe("<em>a</em>");
	});
	test("throws when the words are not in the html", () => {
		expect(() => htmlInEdition("57:1.4", "<p>other words</p>", e1955)).toThrow();
	});
});

describe("rows in an edition", () => {
	const row = {
		standardReferenceId: "27:6.4",
		text: "every possible method of instruction, including the higher graph technique",
		htmlText:
			"<span>every possible method of instruction, including the higher graph technique</span>",
	};
	test("gives the text and html of the edition and its id", () => {
		const [r] = inEdition([row], ed("1955"));
		expect(r?.text).toBe(
			"every possible method of instruction including the higher graph technique",
		);
		expect(r?.htmlText).toBe(
			"<span>every possible method of instruction including the higher graph technique</span>",
		);
		expect(r?.edition).toBe("1955");
	});
	test("a row with no year changes only in 1955", () => {
		const [r] = inEdition([row], ed("srt-2009"));
		expect(r?.text).toBe(row.text);
		expect(r?.edition).toBe("srt-2009");
	});
	test("variants: the public form, [] for a paragraph with none", () => {
		const [a, b] = withVariants([
			{ standardReferenceId: "98:3.8" },
			{ standardReferenceId: "1:0.1" },
		]);
		expect(a?.variants.map((v) => [v.year, v.before, v.after, v.applied])).toEqual([
			[
				2024,
				"more than twoscore self-elevated human deities",
				"more than two-score self-elevated human deities",
				true,
			],
		]);
		expect(b?.variants).toEqual([]);
		expect(Object.keys(a?.variants[0] ?? {})).not.toContain("inStoredText");
	});
});

describe("the edition of a request", () => {
	test("the default, a year id, a Foundation number, or a version stamp", () => {
		const id = (x?: string, lang?: string) => {
			const c = chooseEdition(x, lang);
			return "edition" in c ? c.edition.id : c.type;
		};
		expect(id()).toBe(DEFAULT_EDITION);
		expect(id("1955")).toBe("1955");
		expect(id("21")).toBe("srt-2021");
		expect(id("UF-202412132348")).toBe("srt-2024");
		expect(id("1956")).toBe("unknown-edition");
		expect(id("1955", "es")).toBe("edition-needs-english");
		expect(id("1955", "eng")).toBe("1955");
		expect(id("srt-2024", "es")).toBe("srt-2024");
	});
	test("editionInfo has the ids and no more", () => {
		expect(Object.keys(editionInfo(ed("srt-2021")))).toEqual([
			"id",
			"label",
			"year",
			"foundationVersion",
			"versionStamp",
		]);
	});
});
