import { describe, expect, it } from "bun:test";
import { fixSource, SOURCE_FIXES } from "../../scripts/scriptures/source-fixes";

const passage = (ref: string, text: string) => ({ ref, text, division: "8", subdivision: 82 });

describe("fixSource", () => {
	it("corrects a typo of the source in its one passage", () => {
		const out = fixSource("rig-veda-griffith-1896", [
			passage(
				"RV 8.82.28",
				"Bring to us all things excellent, O Satakratu, food and strength: For, Indra, thou art kind to us.",
			),
			passage(
				"RV 8.82.29",
				"O Satakratu, bring to us all blessings, all felicity: Fbr, Indra, thou art kind to us.",
			),
		]);
		expect(out[1]?.text).toBe(
			"O Satakratu, bring to us all blessings, all felicity: For, Indra, thou art kind to us.",
		);
		expect(out[0]?.text).toContain("For, Indra");
	});

	it("fails when a listed typo is no longer in the source, so the list stays true", () => {
		expect(() =>
			fixSource("rig-veda-griffith-1896", [
				passage("RV 8.82.29", "all felicity: For, Indra, thou art kind to us."),
			]),
		).toThrow(/RV 8.82.29/);
	});

	it("fails when the passage of a fix is missing", () => {
		expect(() =>
			fixSource("rig-veda-griffith-1896", [
				passage("RV 8.82.28", "For, Indra, thou art kind to us."),
			]),
		).toThrow(/RV 8.82.29/);
	});

	it("leaves a work with no fixes as it is", () => {
		const list = [passage("Dhp 1", "All that we are is the result of what we have thought.")];
		expect(fixSource("dhammapada-muller-1881", list)).toEqual(list);
	});

	it("lists each fix by work and reference", () => {
		expect(SOURCE_FIXES["rig-veda-griffith-1896"]).toEqual([
			{ ref: "RV 8.82.29", from: "Fbr, Indra", to: "For, Indra" },
		]);
	});
});
