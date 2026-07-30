import { describe, it, expect } from "vitest";
// Red until implemented: the editor's markdown boundary (plan A2/A3, F3/F4).
import {
	parseNoteMarkdown,
	serializeNoteDoc,
	canonicalizeNoteMarkdown, // C(md) = serialize(parse(md)), house serializer config
} from "../../components/editor/markdown";
import { findCanonReferences } from "../../components/editor/reference-rule";

/** A2 (CF-2) — the storage invariant is CANONICAL FORM, not byte-identity:
 * C is idempotent; every save stores C; these fixtures are already-canonical
 * (house config: `-` bullets, `*` emphasis, ATX headings, trailing \n) so
 * C(md) === md must hold for them. */
const CANONICAL_FIXTURES: Array<[name: string, md: string]> = [
	["empty doc", ""],
	["plain paragraph", "Faith is not a perfect knowledge.\n"],
	["heading levels", "# Alma 32\n\n## The seed\n\n### Planting\n"],
	["bold and italic", "This is **bold** and this is *italic*.\n"],
	["bullet list", "- first\n- second\n- third\n"],
	["nested list", "- outer\n  - inner\n  - inner two\n- outer two\n"],
	["ordered list", "1. plant\n2. nourish\n3. harvest\n"],
	["blockquote", "> compare the word unto a seed\n"],
	["wikilink bare", "See [[alma-32-21]] for the seed.\n"],
	["wikilink labeled", "See [[alma-32-21|the seed passage]] for more.\n"],
	["wikilink entity", "On [[nephi-1|Nephi]] and obedience.\n"],
	["transcript wikilink", "Discussed at [[unshaken-O3SiM9Yi940@144.5|this moment]].\n"],
	[
		"mixed document",
		"# Study\n\nFaith per [[alma-32-21]]:\n\n- **experiment** on the word\n- *nourish* it\n\n> it beginneth to be delicious to me\n",
	],
];

/** Non-canonical inputs and the canonical form they must map to. */
const CANONICALIZATION_MAP: Array<[name: string, input: string, canonical: string]> = [
	["star bullets → dash", "* first\n* second\n", "- first\n- second\n"],
	["underscore emphasis → star", "_italic_ and __bold__\n", "*italic* and **bold**\n"],
	["setext heading → ATX", "Alma 32\n=======\n", "# Alma 32\n"],
	["missing trailing newline", "no newline", "no newline\n"],
];

describe("harness F3/A2 — canonical-form invariant", () => {
	for (const [name, md] of CANONICAL_FIXTURES) {
		it(`canonical fixture is a fixed point: ${name}`, () => {
			expect(serializeNoteDoc(parseNoteMarkdown(md))).toBe(md);
		});
	}

	for (const [name, input, canonical] of CANONICALIZATION_MAP) {
		it(`canonicalizes: ${name}`, () => {
			expect(canonicalizeNoteMarkdown(input)).toBe(canonical);
		});
	}

	it("C is idempotent over every fixture class", () => {
		for (const [, md] of CANONICAL_FIXTURES) {
			const once = canonicalizeNoteMarkdown(md);
			expect(canonicalizeNoteMarkdown(once)).toBe(once);
		}
		for (const [, input] of CANONICALIZATION_MAP) {
			const once = canonicalizeNoteMarkdown(input);
			expect(canonicalizeNoteMarkdown(once)).toBe(once);
		}
	});
});

describe("harness A3 (CF-3) — out-of-schema constructs NEVER throw; text survives", () => {
	const OUT_OF_SCHEMA: Array<[name: string, md: string, mustSurvive: string]> = [
		["inline code", "some `code` here\n", "code"],
		["fenced block", "```js\nalert(1)\n```\n", "alert(1)"],
		["indented code (paste-reachable)", "    four spaces deep\n", "four spaces deep"],
		["thematic break", "above\n\n---\n\nbelow\n", "below"],
		["md link", "[a](https://b.example)\n", "a"],
		["autolink", "<https://example.com>\n", "example.com"],
		["image", "![alt](https://evil.example/x.png)\n", "alt"],
		["raw html", "<div>raw</div>\n", "raw"],
	];

	for (const [name, md, mustSurvive] of OUT_OF_SCHEMA) {
		it(`parse never throws and text is preserved: ${name}`, () => {
			let doc: ReturnType<typeof parseNoteMarkdown>;
			expect(() => {
				doc = parseNoteMarkdown(md);
			}).not.toThrow();
			expect(serializeNoteDoc(doc!)).toContain(mustSurvive);
		});
	}
});

describe("harness A2 (CF-42) — wikilink label grammar", () => {
	it("labels containing | or ]] are sanitized on serialize, never ambiguous", () => {
		// implementation may strip or escape — the pin is that C is a fixed
		// point afterward and the ref survives intact
		const dirty = canonicalizeNoteMarkdown("[[alma-32-21|has | pipe and ]] close]]\n");
		expect(canonicalizeNoteMarkdown(dirty)).toBe(dirty);
		expect(dirty).toContain("alma-32-21");
	});
});

/** F4/A12 — the reference input rule's detector: true refs link, prose never does. */
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

	it("A12: abbreviation periods normalize (parseReference alone returns unknown here)", () => {
		expect(findCanonReferences("read 1 Ne. 3:7 tonight")).toEqual([
			expect.objectContaining({ ref: "1-ne-3-7" }),
		]);
	});

	it("A12: lowercase reference from mobile autocapitalize-off keyboards", () => {
		expect(findCanonReferences("see alma 32:21 today")).toEqual([
			expect.objectContaining({ ref: "alma-32-21" }),
		]);
	});

	it("A12: no fire on a trailing range dash (range policy: don't mangle)", () => {
		expect(findCanonReferences("Alma 32:21-")).toEqual([]);
	});

	it("never links prose that merely resembles a reference", () => {
		for (const text of [
			"He said unto them 3:16 style",
			"meet at 3 in the morning",
			"John said nothing here",
			"32:21 alone with no book",
			"the 3 Nephites", // folk name, not 3 Nephi
			"I told John 3 times", // chapter-shaped common-word trap (CF-28)
			"she acts 2 ways", // Acts 2 trap
		]) {
			expect(findCanonReferences(text)).toEqual([]);
		}
	});

	it("fail-closed on unknown books", () => {
		expect(findCanonReferences("see Hezekiah 4:12 for details")).toEqual([]);
	});
});
