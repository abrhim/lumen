import { describe, it, expect, beforeEach } from "vitest";
import {
	sanitizeWikilinkLabel,
	insertLabel,
	canonicalizeNoteMarkdown,
	parseNoteMarkdown,
} from "~/components/editor/markdown";
import { lumenUrlToRef } from "~/components/editor/lumen-url";
import { findCanonReferences } from "~/components/editor/reference-rule";
import { suggestDestinations, type InsertSuggestion } from "~/components/editor/suggest";
import { pushEscape, popEscape, escapeDepth, handleEscapeKeydown } from "~/lib/escape-registry";

/**
 * Step-12 repro tests for the fix pass (worker A). Every block below FAILED
 * against the pre-fix editor; the bug id is on the describe.
 */

/* ─── B17/CP-18 — lumenUrlToRef never checked the origin ─── */

describe("B17 — pasted URLs convert only when they are OURS", () => {
	const ORIGIN = "https://lumen.example";

	it("converts same-origin scripture, media and entity URLs", () => {
		expect(lumenUrlToRef(`${ORIGIN}/scripture/alma/32?verse=21`, ORIGIN)).toBe("alma-32-21");
		expect(lumenUrlToRef(`${ORIGIN}/scripture/alma/32`, ORIGIN)).toBe("alma-32");
		expect(lumenUrlToRef(`${ORIGIN}/media/unshaken-O3SiM9Yi940?t=144.5`, ORIGIN)).toBe(
			"unshaken-O3SiM9Yi940@144.5",
		);
		expect(lumenUrlToRef(`${ORIGIN}/people/nephi-1`, ORIGIN)).toBe("nephi-1");
	});

	it("accepts a bare in-app pathname (a link copied out of the app)", () => {
		expect(lumenUrlToRef("/scripture/alma/32?verse=21", ORIGIN)).toBe("alma-32-21");
		expect(lumenUrlToRef("/people/nephi-1", ORIGIN)).toBe("nephi-1");
	});

	it("REFUSES foreign origins — the paste must survive as text", () => {
		for (const raw of [
			"https://en.wikipedia.org/wiki/faith",
			"https://github.com/anthropics/claude",
			"https://evil.example/scripture/alma/32?verse=21",
			"http://lumen.example/scripture/alma/32", // scheme differs → different origin
			"https://lumen.example.attacker.test/scripture/alma/32",
		]) {
			expect(lumenUrlToRef(raw, ORIGIN)).toBeNull();
		}
	});

	it("fails closed when no origin can be determined", () => {
		expect(lumenUrlToRef(`${ORIGIN}/scripture/alma/32`, null)).toBeNull();
	});

	it("only typed-node routes carry entity ids (two-segment tightening)", () => {
		expect(lumenUrlToRef(`${ORIGIN}/collections/nephi-1`, ORIGIN)).toBeNull();
		expect(lumenUrlToRef(`${ORIGIN}/places/rameumptom`, ORIGIN)).toBe("rameumptom");
	});
});

/* ─── B18/CP-19 — sanitizeWikilinkLabel passed newlines through ─── */

describe("B18 — the label sanitizer's re-tokenize guarantee holds for whitespace", () => {
	const DIRTY = ["a\nb", "a\r\nb", "a\tb", "a|b", "a]]b", "a  \n  b"];

	it("collapses every whitespace run — no label can carry a newline", () => {
		expect(sanitizeWikilinkLabel("a\nb")).toBe("a b");
		expect(sanitizeWikilinkLabel("a\r\nb")).toBe("a b");
		expect(sanitizeWikilinkLabel("first\n\n# heading\n")).toBe("first # heading");
		for (const dirty of DIRTY) expect(sanitizeWikilinkLabel(dirty)).not.toMatch(/[\r\n\t]/);
	});

	it("a sanitized label always re-tokenizes to the same wikilink node", () => {
		for (const dirty of DIRTY) {
			const label = sanitizeWikilinkLabel(dirty);
			const md = `x [[gen-1|${label}]] y\n`;
			const canonical = canonicalizeNoteMarkdown(md);
			expect(canonical).toContain(`[[gen-1|${label}]]`);
			// C is a fixed point, and the node really is a wikilink
			expect(canonicalizeNoteMarkdown(canonical)).toBe(canonical);
			let found: string | null = null;
			parseNoteMarkdown(canonical).descendants((node) => {
				if (node.type.name === "wikilink") found = node.attrs.ref as string;
			});
			expect(found).toBe("gen-1");
		}
	});

	it("caps a pathological label instead of letting it dominate the body", () => {
		expect(sanitizeWikilinkLabel("x".repeat(5000)).length).toBe(200);
	});

	it("keeps the ratified grammar: | and brackets never survive", () => {
		expect(sanitizeWikilinkLabel("has | pipe and ]] close")).toBe("has pipe and close");
	});
});

/* ─── B47/CP-52 — insert paths stored a label the writer never saw ─── */

describe("B47 — insert paths sanitize the label they put on the node", () => {
	it("sanitizes the writer's selected text at the insert site", () => {
		expect(insertLabel("a|b", "alma-32-21")).toBe("ab");
		expect(insertLabel("two\nlines", "alma-32-21")).toBe("two lines");
	});

	it("drops to a bare link when nothing survives, or the label IS the ref", () => {
		expect(insertLabel("|||", "alma-32-21")).toBeNull();
		expect(insertLabel("   ", "alma-32-21")).toBeNull();
		expect(insertLabel("alma-32-21", "alma-32-21")).toBeNull();
		expect(insertLabel(null, "alma-32-21")).toBeNull();
	});

	it("what the doc shows is what the body stores (the CP-52 round trip)", () => {
		const label = insertLabel("a|b", "gen-1")!;
		expect(canonicalizeNoteMarkdown(`see [[gen-1|${label}]]\n`)).toContain(`[[gen-1|${label}]]`);
	});
});

/* ─── B31/CP-33 — the detector swallowed leading punctuation ─── */

describe("B31 — the matched span starts at the book, not at the punctuation", () => {
	it("leading punctuation stays with the writer's prose", () => {
		for (const [text, index] of [
			["...Alma 32:21", 3],
			["..Alma 32:21", 2],
			["&Alma 32:21", 1],
			["…Alma 32:21", 1],
		] as const) {
			const [m] = findCanonReferences(text);
			expect(m).toBeDefined();
			expect(m.ref).toBe("alma-32-21");
			expect(m.text).toBe("Alma 32:21");
			expect(m.index).toBe(index);
			expect(m.length).toBe("Alma 32:21".length);
			// the span the auto-link rule replaces must be exactly the match
			expect(text.slice(m.index, m.index + m.length)).toBe(m.text);
		}
	});

	it("chapter form trims the same way", () => {
		const [m] = findCanonReferences("...Alma 32 rewards study");
		expect(m).toBeDefined();
		expect(m.text).toBe("Alma 32");
		expect(m.index).toBe(3);
	});

	it("abbreviation periods still normalize (the guard that admitted `.`)", () => {
		expect(findCanonReferences("read 1 Ne. 3:7 tonight")).toEqual([
			expect.objectContaining({ ref: "1-ne-3-7", text: "1 Ne. 3:7" }),
		]);
	});

	it("still never links prose that merely resembles a reference", () => {
		for (const text of [
			"I told John 3 times",
			"she acts 2 ways",
			"meet at 3 in the morning",
			"32:21 alone with no book",
		]) {
			expect(findCanonReferences(text)).toEqual([]);
		}
	});
});

/* ─── B48/CP-53 — the equal-length list fixture ─── */

describe("B48 — equal-length suggestion lists with different destinations exist", () => {
	// The construction panel-2 insisted on: `highlight` was reset on
	// `suggestions.length`, so this pair (28 rows each, nothing in common)
	// let a stale index commit a destination the writer never highlighted.
	// The editor now keys the reset on list identity — this test pins the
	// fixture that makes that necessary.
	it("'alma 3' and 'mosiah 3' return the same COUNT and different rows", () => {
		const a = suggestDestinations("alma 3");
		const b = suggestDestinations("mosiah 3");
		expect(a.length).toBe(b.length);
		expect(a.length).toBeGreaterThan(2);
		expect(a[0].ref).not.toBe(b[0].ref);
		const key = (xs: InsertSuggestion[]) => xs.map((s) => s.ref).join(" ");
		expect(key(a)).not.toBe(key(b));
	});
});

/* ─── B16/CP-17 — Escape was popped in a microtask ─── */

describe("B16 — the global Escape handler consumes the key SAME-TICK", () => {
	beforeEach(() => {
		while (escapeDepth() > 0) popEscape();
	});

	function fakeEscape() {
		let prevented = false;
		let stopped = false;
		return {
			event: {
				key: "Escape",
				preventDefault: () => {
					prevented = true;
				},
				stopPropagation: () => {
					stopped = true;
				},
			},
			get prevented() {
				return prevented;
			},
			get stopped() {
				return stopped;
			},
		};
	}

	it("closes the innermost layer and prevents the event before returning", () => {
		const closed: string[] = [];
		pushEscape({ onEscape: () => closed.push("outer") });
		pushEscape({ onEscape: () => closed.push("inner") });
		const e = fakeEscape();

		expect(handleEscapeKeydown(e.event)).toBe(true);
		// synchronous: both the close and the preventDefault have already run
		expect(closed).toEqual(["inner"]);
		expect(e.prevented).toBe(true);
		expect(e.stopped).toBe(true);
		expect(escapeDepth()).toBe(1);
	});

	it("is inert with an empty registry — Esc never eats a chapter", () => {
		const e = fakeEscape();
		expect(handleEscapeKeydown(e.event)).toBe(false);
		expect(e.prevented).toBe(false);
	});

	it("ignores non-Escape keys and already-handled events", () => {
		pushEscape({ onEscape: () => {} });
		expect(handleEscapeKeydown({ ...fakeEscape().event, key: "Enter" })).toBe(false);
		expect(handleEscapeKeydown({ ...fakeEscape().event, defaultPrevented: true })).toBe(false);
		expect(escapeDepth()).toBe(1);
	});
});
