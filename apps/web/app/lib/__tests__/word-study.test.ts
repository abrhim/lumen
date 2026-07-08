import { describe, it, expect } from "vitest";
import {
	buildWordSegments,
	segmentsReconstruct,
	structureDefinition,
	strongsLanguage,
	primaryEntry,
	wordGroupPositions,
} from "../word-study";
import type { WordTagRow } from "@lumen/scripture";

const tag = (o: Partial<WordTagRow>): WordTagRow => ({
	word_id: "x", position: 1, char_start: 0, char_end: 1,
	strongs: ["H1"], morph: null, entries: [], ...o,
});

describe("buildWordSegments (strongs FM-7)", () => {
	const text = "For God so loved the world";

	it("property: segments always reconstruct the EXACT original text", () => {
		const tags = [
			tag({ word_id: "w2", char_start: 4, char_end: 7 }), // God
			tag({ word_id: "w4", char_start: 11, char_end: 16 }), // loved
		];
		const segs = buildWordSegments(text, tags);
		expect(segmentsReconstruct(text, segs)).toBe(true);
		expect(segs.find((s) => s.tag?.word_id === "w2")?.text).toBe("God");
	});

	it("bad offsets are dropped defensively — the text never corrupts", () => {
		const segs = buildWordSegments(text, [
			tag({ char_start: 20, char_end: 999 }), // out of range
			tag({ char_start: 4, char_end: 7 }),
		]);
		expect(segmentsReconstruct(text, segs)).toBe(true);
	});

	it("no tags → one plain segment", () => {
		const segs = buildWordSegments(text, []);
		expect(segs).toEqual([{ text, tag: null }]);
	});
});

describe("structureDefinition (word page typesetting)", () => {
	it("maps Abbott-Smith __ markers to an indent hierarchy", () => {
		const def = [
			"διά prep. with genitive, accusative, as in cl.;",
			"__1. with genitive, through;",
			"__(i) of Place, after verbs of motion;",
			"__(a) during which: Mat.26:61;",
			"__2. C. accusative;",
		].join("\n");
		const lines = structureDefinition(def);
		expect(lines.map((l) => l.depth)).toEqual([0, 1, 2, 3, 1]);
		expect(lines[1].text).toMatch(/^1\. with genitive/);
	});

	it("plain multi-line definitions come through at depth 0", () => {
		expect(structureDefinition("a lost thing\nsomething lost").every((l) => l.depth === 0)).toBe(true);
	});
});

describe("strongsLanguage", () => {
	it("H → Hebrew, G → Greek", () => {
		expect(strongsLanguage("H7225")).toBe("Hebrew");
		expect(strongsLanguage("G25")).toBe("Greek");
	});
});

describe("primaryEntry (Abram's 'taxing' bug)", () => {
	it("skips tag-along function words: [ὁ, ἀπογραφή] leads with the noun", () => {
		expect(
			primaryEntry([{ strongs_no: "G3588" }, { strongs_no: "G582" }])?.strongs_no,
		).toBe("G582");
		expect(
			primaryEntry([{ strongs_no: "H853" }, { strongs_no: "H8064" }])?.strongs_no,
		).toBe("H8064");
	});

	it("a word that IS a function word still shows itself", () => {
		expect(primaryEntry([{ strongs_no: "G3588" }])?.strongs_no).toBe("G3588");
		expect(primaryEntry([])).toBeUndefined();
	});
});

describe("wordGroupPositions (group highlight)", () => {
	const t = (position: number, strongs: string[]) =>
		tag({ position, strongs, word_id: `w${position}` });

	it("'to be taxed' — one Greek word across three English words — groups", () => {
		const tags = [t(3, ["G4198"]), t(4, ["G583"]), t(5, ["G583"]), t(6, ["G583"]), t(7, ["G1538"])];
		expect(wordGroupPositions(tags, 5)).toEqual(new Set([4, 5, 6]));
	});

	it("a lone word groups with itself; untagged neighbors break the run", () => {
		const tags = [t(2, ["G583"]), t(4, ["G583"])]; // gap at 3
		expect(wordGroupPositions(tags, 2)).toEqual(new Set([2]));
		expect(wordGroupPositions(tags, 9)).toEqual(new Set([9])); // position without a tag
	});

	it("identical numbers in a DIFFERENT signature don't merge", () => {
		const tags = [t(1, ["G3588", "G582"]), t(2, ["G582"])];
		expect(wordGroupPositions(tags, 2)).toEqual(new Set([2]));
	});
});
