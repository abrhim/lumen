import { describe, it, expect } from "vitest";
import {
	segmentClasses,
	segmentVerse,
	type MarkRange,
	type WordRange,
} from "../verse-segments";

/** Overlapping marks are a feature, not an edge case, so the cutting is tested
 * rather than eyeballed (docs/design/highlighting.md). */

const mark = (id: string, start: number, end: number, color = "yellow", style = "highlight"): MarkRange => ({ id, start, end, color, style });

/** word ranges as the Bible reader produces them */
const words = (text: string): WordRange[] => {
	const out: WordRange[] = [];
	const re = /[A-Za-z0-9’']+/g;
	let m: RegExpExecArray | null;
	let n = 1;
	while ((m = re.exec(text)) !== null) {
		out.push({ position: n++, start: m.index, end: m.index + m[0].length });
	}
	return out;
};

describe("segmentVerse", () => {
	const text = "faith is not to have";

	it("covers the verse exactly once, with no marks and no words", () => {
		const segs = segmentVerse(text.length, [], []);
		expect(segs).toHaveLength(1);
		expect(segs[0]).toMatchObject({ start: 0, end: text.length, marks: [] });
	});

	it("the pieces always rebuild the verse", () => {
		const segs = segmentVerse(text.length, words(text), [mark("m1", 6, 12)]);
		expect(segs.map((s) => text.slice(s.start, s.end)).join("")).toBe(text);
	});

	it("cuts at a mark edge that falls mid-word", () => {
		// "fai|th" — the mark starts inside the first word
		const segs = segmentVerse(text.length, words(text), [mark("m1", 3, 8)]);
		const marked = segs.filter((s) => s.marks.length > 0);
		expect(text.slice(marked[0].start, marked[marked.length - 1].end)).toBe("th is");
	});

	it("carries the word position so word study still works under a mark", () => {
		const segs = segmentVerse(text.length, words(text), [mark("m1", 0, 5)]);
		const first = segs[0];
		expect(first.wordPosition).toBe(1);
		expect(first.marks).toHaveLength(1);
	});

	it("a piece covered by two marks reports both", () => {
		const segs = segmentVerse(text.length, [], [mark("a", 0, 10), mark("b", 6, 20)]);
		const both = segs.find((s) => s.marks.length === 2);
		expect(both).toBeDefined();
		expect(both!.marks.map((m) => m.id)).toEqual(["a", "b"]);
		// marks [0,10) and [6,20) overlap on [6,10)
		expect(text.slice(both!.start, both!.end)).toBe("is n");
	});

	it("a mark nested wholly inside another yields three pieces", () => {
		const segs = segmentVerse(text.length, [], [mark("outer", 0, 20), mark("inner", 6, 12)]);
		expect(segs.map((s) => s.marks.length)).toEqual([1, 2, 1]);
	});

	it("a mark covering the whole verse produces one piece", () => {
		const segs = segmentVerse(text.length, [], [mark("m", 0, text.length)]);
		expect(segs).toHaveLength(1);
		expect(segs[0].marks).toHaveLength(1);
	});

	it("mark edges outside the verse do not create phantom cuts", () => {
		const segs = segmentVerse(text.length, [], [mark("m", -5, 999)]);
		expect(segs).toHaveLength(1);
		expect(segs[0]).toMatchObject({ start: 0, end: text.length });
	});

	it("an empty verse produces nothing", () => {
		expect(segmentVerse(0, [], [mark("m", 0, 5)])).toEqual([]);
	});

	it("books with no word tags cut on mark edges alone", () => {
		const segs = segmentVerse(text.length, [], [mark("m", 6, 12)]);
		expect(segs).toHaveLength(3);
		expect(segs.every((s) => s.wordPosition === undefined)).toBe(true);
	});
});

describe("segmentClasses", () => {
	it("no marks means no classes", () => {
		expect(segmentClasses({ start: 0, end: 1, marks: [] })).toBe("");
	});

	it("a highlight paints a row tint", () => {
		const c = segmentClasses({ start: 0, end: 1, marks: [mark("m", 0, 1, "green")] });
		expect(c).toContain("hl-green");
		expect(c).toContain("hl-row");
	});

	it("the LAST fill wins the background — the newest intent reads on top", () => {
		const c = segmentClasses({
			start: 0,
			end: 1,
			marks: [mark("a", 0, 1, "yellow"), mark("b", 0, 1, "blue")],
		});
		expect(c).toContain("hl-blue");
		expect(c).not.toContain("hl-yellow");
	});

	it("an underline rides along with a highlight instead of replacing it", () => {
		const c = segmentClasses({
			start: 0,
			end: 1,
			marks: [mark("a", 0, 1, "yellow"), mark("b", 0, 1, "red", "underline")],
		});
		expect(c).toContain("hl-yellow");
		expect(c).toContain("hl-row");
		expect(c).toContain("hl-underline");
	});

	it("text colour paints no background", () => {
		const c = segmentClasses({ start: 0, end: 1, marks: [mark("m", 0, 1, "purple", "text")] });
		expect(c).toContain("hl-text");
		expect(c).not.toContain("hl-row");
	});
});
