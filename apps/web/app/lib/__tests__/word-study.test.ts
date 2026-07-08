import { describe, it, expect } from "vitest";
import { buildWordSegments, segmentsReconstruct } from "../word-study";
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
