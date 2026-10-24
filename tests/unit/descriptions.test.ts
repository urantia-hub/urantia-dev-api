import { describe, expect, it } from "bun:test";
import {
	checkDescriptions as check,
	type DescriptionAnswer,
	type DescriptionEntry,
} from "../../scripts/translate/agent/descriptions.ts";
import type { Term } from "../../scripts/translate/agent/lib.ts";

// One glossary term, so the tests need no source files.
const universe: Term = {
	en: "universe of universes",
	enForms: ["universe of universes"],
	target: "universo de los universos",
	aliases: [],
	type: "concept",
	required: true,
};
const termsIn = (text: string) => (text.includes(universe.en) ? [universe] : []);
const checkDescriptions = (
	lang: string,
	entries: DescriptionEntry[],
	answers: Record<string, DescriptionAnswer>,
) => check(lang, entries, answers, termsIn);

const father: DescriptionEntry = {
	id: "universal-father",
	name: "Universal Father",
	target: "Padre Universal",
	description:
		"The First Person of Deity, the creator and controller of the universe of universes.",
};
const plain: DescriptionEntry = {
	id: "x-plain",
	name: "plain",
	target: "llano",
	description: "A level field.",
};

describe("checkDescriptions", () => {
	it("fails an entry that the answer leaves out, by its id", () => {
		const { issues } = checkDescriptions("es", [father, plain], {
			[plain.id]: { description: "Un campo llano." },
		});
		expect(issues).toContainEqual(
			expect.objectContaining({ id: "universal-father", check: "missing" }),
		);
	});
	it("fails a description that is still English", () => {
		const { issues } = checkDescriptions("es", [plain], {
			[plain.id]: {
				description: "A level field of the plain, which is the place that the people use.",
			},
		});
		expect(issues).toContainEqual(expect.objectContaining({ id: "x-plain", check: "english" }));
	});
	it("warns on a glossary term written in another form, and accepts the entry", () => {
		const { issues, warnings, passed } = checkDescriptions("es", [father], {
			[father.id]: {
				description: "La Primera Persona de la Deidad, creador y gobernante del cosmos entero.",
			},
		});
		expect(issues).toEqual([]);
		expect(warnings).toContainEqual(
			expect.objectContaining({ id: "universal-father", check: "term" }),
		);
		expect(passed.has(father.id)).toBe(true);
	});
	it("passes a good Spanish description and returns it", () => {
		const good =
			"La Primera Persona de la Deidad, creador y gobernante del universo de los universos.";
		const { issues, passed } = checkDescriptions("es", [father], {
			[father.id]: { description: good },
		});
		expect(issues).toEqual([]);
		expect(passed.get(father.id)).toEqual({ description: good });
	});
	it("ignores an answer for an id that the packet does not hold", () => {
		const { issues, passed } = checkDescriptions("es", [plain], {
			[plain.id]: { description: "Un campo llano." },
			"some-ordinary-word": { description: "Algo." },
		});
		expect(issues).toEqual([]);
		expect(passed.has("some-ordinary-word")).toBe(false);
	});
	it("needs a name for an entry with no Spanish name", () => {
		const noName = { ...plain, id: "x-new", target: null };
		const { issues } = checkDescriptions("es", [noName], {
			"x-new": { description: "Un campo llano." },
		});
		expect(issues).toContainEqual(expect.objectContaining({ id: "x-new", check: "name" }));
	});
});
