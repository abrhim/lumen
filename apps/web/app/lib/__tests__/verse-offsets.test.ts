import { describe, it, expect } from "vitest";
import {
	indexTextPieces,
	offsetOfPosition,
	quoteOf,
	snapSpans,
	snapToWords,
	type NodeLike,
} from "../verse-offsets";

/**
 * The offset maths behind passage marks (docs/design/highlighting.md).
 * Wrong offsets put marks on the wrong words and nothing complains, so this is
 * tested as pure logic rather than through a browser.
 */

/* ---- minimal DOM stand-ins. Real nodes satisfy NodeLike structurally. ---- */
const text = (s: string): NodeLike => ({ nodeType: 3, textContent: s, childNodes: [] });
const el = (...children: NodeLike[]): NodeLike => ({
	nodeType: 1,
	textContent: children.map((c) => c.textContent ?? "").join(""),
	childNodes: children,
});

/** How the Book of Mormon renders: one text node. */
const plainVerse = (s: string) => {
	const t = text(s);
	return { container: el(t), t };
};

/** How a Bible chapter renders: word spans with bare text between them, which
 * is what VerseWords emits. */
const wordVerse = (s: string) => {
	const parts: NodeLike[] = [];
	const re = /[A-Za-z0-9’']+|[^A-Za-z0-9’']+/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(s)) !== null) {
		const piece = text(m[0]);
		parts.push(/[A-Za-z0-9]/.test(m[0]) ? el(piece) : piece);
	}
	return { container: el(...parts), parts };
};

describe("indexTextPieces — the two DOM shapes", () => {
	it("a single text node maps one-to-one", () => {
		const { container } = plainVerse("And it came to pass");
		const pieces = indexTextPieces(container);
		expect(pieces).toHaveLength(1);
		expect(pieces[0]).toMatchObject({ start: 0, end: 19 });
	});

	it("word spans and the gaps between them reproduce the verse exactly", () => {
		const s = "faith is not to have a perfect knowledge";
		const { container } = wordVerse(s);
		const pieces = indexTextPieces(container);
		expect(pieces.length).toBeGreaterThan(1);
		// concatenating the pieces must rebuild the verse — this is the property
		// the whole offset scheme rests on
		expect(pieces.map((p) => p.node.textContent).join("")).toBe(s);
		expect(pieces[pieces.length - 1].end).toBe(s.length);
	});

	it("empty text nodes take no space", () => {
		const container = el(text("ab"), text(""), text("cd"));
		expect(indexTextPieces(container).map((p) => [p.start, p.end])).toEqual([
			[0, 2],
			[2, 4],
		]);
	});
});

describe("offsetOfPosition", () => {
	it("resolves a position inside a plain text node", () => {
		const { container, t } = plainVerse("And it came to pass");
		const pieces = indexTextPieces(container);
		expect(offsetOfPosition(pieces, container, t, 4)).toBe(4);
	});

	it("resolves a position inside a later word span", () => {
		const s = "faith is not";
		const { container } = wordVerse(s);
		const pieces = indexTextPieces(container);
		const notNode = pieces.find((p) => p.node.textContent === "not")!;
		// 1 character into "not", which begins at index 9
		expect(offsetOfPosition(pieces, container, notNode.node, 1)).toBe(10);
	});

	it("resolves an ELEMENT position to the start of that child", () => {
		const s = "faith is not";
		const { container } = wordVerse(s);
		const pieces = indexTextPieces(container);
		// boundary before child 2 — the space between "faith" and "is"
		expect(offsetOfPosition(pieces, container, container, 1)).toBe(5);
	});

	it("an element position past the last child is the end of the text", () => {
		const s = "faith is not";
		const { container } = wordVerse(s);
		const pieces = indexTextPieces(container);
		expect(offsetOfPosition(pieces, container, container, 99)).toBe(s.length);
	});

	it("returns null for a node outside the container — never a wrong number", () => {
		const { container } = plainVerse("inside");
		const pieces = indexTextPieces(container);
		expect(offsetOfPosition(pieces, container, text("outside"), 0)).toBeNull();
	});
});

describe("snapToWords", () => {
	const s = "And now as I said concerning faith--faith is not to have a perfect knowledge";

	it("grows a part-word selection out to the whole word", () => {
		// "onc" inside "concerning" (starts at 18)
		expect(snapToWords(s, 21, 24)).toEqual({ start: 18, end: 28 });
	});

	it("keeps interior punctuation inside the range", () => {
		const p = "verily, verily, I say";
		// from inside the first "verily" to inside the last
		const r = snapToWords(p, 2, 17)!;
		expect(p.slice(r.start, r.end)).toBe("verily, verily, I");
		// one interval, so the commas are carried — not two bands with a gap
		expect(p.slice(r.start, r.end)).toContain(",");
	});

	it("a start in a gap moves FORWARD — it does not swallow the word behind", () => {
		// index 3 is the space after "And"
		const r = snapToWords(s, 3, 7)!;
		expect(s.slice(r.start, r.end)).toBe("now");
	});

	it("an end in a gap moves BACK — it does not swallow the word ahead", () => {
		// "And now " → end lands in the space before "as"
		const r = snapToWords(s, 0, 8)!;
		expect(s.slice(r.start, r.end)).toBe("And now");
	});

	it("a selection entirely inside whitespace is not a mark", () => {
		expect(snapToWords("And   now", 3, 6)).toBeNull();
	});

	it("a collapsed selection in a gap is not a mark", () => {
		expect(snapToWords(s, 3, 3)).toBeNull();
	});

	it("a backwards selection is normalised, not rejected", () => {
		expect(snapToWords(s, 24, 21)).toEqual({ start: 18, end: 28 });
	});

	it("offsets past the end of the verse clamp instead of throwing", () => {
		const r = snapToWords("faith", 0, 9999)!;
		expect(r).toEqual({ start: 0, end: 5 });
	});

	it("text with no words at all yields no mark", () => {
		expect(snapToWords("   --  ", 0, 7)).toBeNull();
	});
});

describe("snapSpans — a selection dragged across verses", () => {
	const v20 = "Now of this thing ye must judge.";
	const v21 = "And now as I said concerning faith";
	const v22 = "And now, behold, I say unto you";

	it("splits into partial, whole, partial", () => {
		const spans = snapSpans([
			{ verseId: "alma-32-20", text: v20, start: 18, end: v20.length },
			{ verseId: "alma-32-21", text: v21, start: 0, end: v21.length },
			{ verseId: "alma-32-22", text: v22, start: 0, end: 8 },
		]);
		expect(spans).toHaveLength(3);
		expect(v20.slice(spans[0].start, spans[0].end)).toBe("ye must judge");
		expect(v21.slice(spans[1].start, spans[1].end)).toBe(v21);
		expect(v22.slice(spans[2].start, spans[2].end)).toBe("And now");
	});

	it("drops a verse whose slice covers no word", () => {
		const spans = snapSpans([
			{ verseId: "a-1-1", text: v20, start: 3, end: 4 }, // one space
			{ verseId: "a-1-2", text: v21, start: 0, end: 3 },
		]);
		expect(spans.map((s) => s.verseId)).toEqual(["a-1-2"]);
	});

	it("an empty selection produces no spans", () => {
		expect(snapSpans([])).toEqual([]);
	});
});

describe("quoteOf", () => {
	it("joins the marked text across verses with a space", () => {
		const inputs = [
			{ verseId: "a-1-1", text: "ye must judge.", start: 0, end: 14 },
			{ verseId: "a-1-2", text: "And now", start: 0, end: 7 },
		];
		const spans = snapSpans(inputs);
		expect(quoteOf(inputs, spans)).toBe("ye must judge And now");
	});

	it("ignores a span whose verse is unknown rather than printing undefined", () => {
		expect(quoteOf([], [{ verseId: "ghost", start: 0, end: 3 }])).toBe("");
	});
});
