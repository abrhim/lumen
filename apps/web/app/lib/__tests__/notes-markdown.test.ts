import { describe, it, expect } from "vitest";
// Red until implemented: the editor's markdown boundary (plan F3/F4).
import { parseNoteMarkdown, serializeNoteDoc } from "../../components/editor/markdown";
import { findCanonReferences } from "../../components/editor/reference-rule";

/** F3 — the storage invariant: markdown → PM doc → markdown is byte-identical.
 * The editor is view-layer only; what was typed is what is stored. */
const ROUND_TRIP_FIXTURES: Array<[name: string, md: string]> = [
	["empty doc", ""],
	["plain paragraph", "Faith is not a perfect knowledge.\n"],
	["heading levels", "# Alma 32\n\n## The seed\n\n### Planting\n"],
	["bold and italic", "This is **bold** and this is *italic* and ***both***.\n"],
	["bullet list", "- first\n- second\n- third\n"],
	["nested list", "- outer\n  - inner\n  - inner two\n- outer two\n"],
	["ordered list", "1. plant\n2. nourish\n3. harvest\n"],
	["blockquote", "> compare the word unto a seed\n"],
	["wikilink bare", "See [[alma-32-21]] for the seed.\n"],
	["wikilink labeled", "See [[alma-32-21|the seed passage]] for more.\n"],
	["wikilink entity", "On [[nephi-1|Nephi]] and obedience.\n"],
	["mixed document", "# Study\n\nFaith per [[alma-32-21]]:\n\n- **experiment** on the word\n- *nourish* it\n\n> it beginneth to be delicious to me\n"],
];

describe("harness F3 — markdown round-trip byte-identity", () => {
	for (const [name, md] of ROUND_TRIP_FIXTURES) {
		it(`round-trips: ${name}`, () => {
			expect(serializeNoteDoc(parseNoteMarkdown(md))).toBe(md);
		});
	}

	it("constructs outside the constrained schema survive as literal text (no data loss, no promotion)", () => {
		// images and raw HTML are OUT of the v1 schema — they must round-trip
		// as escaped/literal text, never become nodes, never be dropped.
		const md = "![alt](https://evil.example/x.png)\n\n<div>raw</div>\n";
		const out = serializeNoteDoc(parseNoteMarkdown(md));
		expect(out).toContain("![alt]");
		expect(out).toContain("<div>raw</div>");
	});
});

/** F4 — the reference input rule's detector: true refs link, prose never does. */
describe("harness F4 — canon reference detection (zero false positives)", () => {
	it("detects verse and chapter references", () => {
		expect(findCanonReferences("as taught in Alma 32:21, faith is")).toEqual([
			expect.objectContaining({ ref: "alma-32-21", text: "Alma 32:21" }),
		]);
		expect(findCanonReferences("read 1 Nephi 3:7 tonight")).toEqual([
			expect.objectContaining({ ref: "1-ne-3-7" }),
		]);
		expect(findCanonReferences("all of Alma 32 rewards study").length).toBe(1);
	});

	it("never links prose that merely resembles a reference", () => {
		for (const text of [
			"He said unto them 3:16 style",
			"meet at 3 in the morning",
			"John said nothing here",
			"32:21 alone with no book",
			"the 3 Nephites", // folk name, not 3 Nephi
		]) {
			expect(findCanonReferences(text)).toEqual([]);
		}
	});

	it("fail-closed on unknown books", () => {
		expect(findCanonReferences("see Hezekiah 4:12 for details")).toEqual([]);
	});
});
