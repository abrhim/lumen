import { describe, it, expect } from "vitest";
import { parseNoteMarkdown, serializeNoteDoc, canonicalizeNoteMarkdown } from "~/components/editor/markdown";
import { renderNoteHtml } from "../notes-render.server";

/** External web links, layer 1 (Abram, 2026-07-31): explicit [label](url)
 * joins the constrained schema; autolink/linkify/image stay OUT; the server
 * renderer is the http(s) gate. */

describe("external links — C(md) round-trip", () => {
	it("[label](https url) survives canonically and idempotently", () => {
		const md = "read [Divine Love](https://www.churchofjesuschrist.org/study/general-conference/2021/10/talk) today\n";
		const once = canonicalizeNoteMarkdown(md);
		expect(once).toContain("[Divine Love](https://www.churchofjesuschrist.org/study/general-conference/2021/10/talk)");
		expect(canonicalizeNoteMarkdown(once)).toBe(once);
	});

	it("urls with parens/spaces stay stable across passes", () => {
		const md = "see [w](https://en.wikipedia.org/wiki/Alma_(Book_of_Mormon))\n";
		const once = canonicalizeNoteMarkdown(md);
		expect(canonicalizeNoteMarkdown(once)).toBe(once);
		// the href reparses to the same destination
		const doc = parseNoteMarkdown(once);
		expect(serializeNoteDoc(doc)).toBe(once);
	});

	it("wikilinks and links coexist in one line", () => {
		const md = "[[alma-32-21|the seed]] and [a talk](https://example.org/x)\n";
		const once = canonicalizeNoteMarkdown(md);
		expect(once).toContain("[[alma-32-21|the seed]]");
		expect(once).toContain("[a talk](https://example.org/x)");
	});
});

describe("external links — renderer gate", () => {
	it("https renders an anchor with the outward contract", () => {
		const html = renderNoteHtml("[a talk](https://example.org/x)\n");
		expect(html).toContain('href="https://example.org/x"');
		expect(html).toContain('class="note-extlink"');
		expect(html).toContain('rel="noopener noreferrer"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain(">a talk</a>");
	});

	it("non-http(s) schemes render as label only — no anchor forms", () => {
		for (const bad of [
			"[x](javascript:alert(1))",
			"[x](data:text/html,hi)",
			"[x](ftp://example.org/f)",
			"[x](/relative/path)",
		]) {
			const html = renderNoteHtml(bad + "\n");
			expect(html).toContain("x");
			expect(html).not.toContain("note-extlink");
			expect(html).not.toContain("javascript:");
		}
	});

	it("autolink and image syntax remain out of schema", () => {
		expect(renderNoteHtml("<https://example.com>\n")).not.toContain("note-extlink");
		expect(renderNoteHtml("![alt](https://evil.example/x.png)\n")).not.toContain("<img");
	});
});
