import { describe, it, expect } from "vitest";
// Red until implemented: server-side constrained renderer (plan D4, F5/F6).
import { renderNoteHtml } from "../notes-render.server";

describe("harness F6 — XSS: every hostile construct is neutralized", () => {
	it("escapes raw HTML blocks and inline tags", () => {
		const html = renderNoteHtml("<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n");
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;script&gt;");
	});

	it("escapes event handlers and javascript: URLs smuggled via link labels", () => {
		const html = renderNoteHtml('[[alma-32-21|<b onmouseover="alert(1)">x</b>]]\n');
		expect(html).not.toContain("onmouseover=");
		expect(html).not.toMatch(/<b[\s>]/);
	});

	it("never emits javascript: hrefs", () => {
		const html = renderNoteHtml("[click](javascript:alert(1))\n");
		expect(html).not.toContain("javascript:");
	});

	it("markdown autolink/image syntax stays out of the constrained schema", () => {
		const html = renderNoteHtml("![alt](https://evil.example/x.png)\n");
		expect(html).not.toContain("<img");
	});
});

describe("harness F5/D4 — wikilinks resolve fail-closed", () => {
	it("a known verse ref renders a link to the reader", () => {
		const html = renderNoteHtml("see [[alma-32-21|the seed]]\n");
		expect(html).toContain('href="/scripture/alma/32?verse=21"');
		expect(html).toContain("the seed");
	});

	it("a chapter ref links the chapter", () => {
		const html = renderNoteHtml("[[alma-32]]\n");
		expect(html).toContain('href="/scripture/alma/32"');
	});

	it("an unknown ref renders as styled plain text — never an anchor, never an error", () => {
		const html = renderNoteHtml("[[narnia-3-1|wardrobe]]\n");
		expect(html).not.toContain("<a ");
		expect(html).toContain("wardrobe");
	});

	it("constrained construct set renders: headings, emphasis, lists, blockquote", () => {
		const html = renderNoteHtml("# T\n\n**b** *i*\n\n- one\n\n> q\n");
		expect(html).toContain("<h1");
		expect(html).toContain("<strong");
		expect(html).toContain("<em");
		expect(html).toContain("<ul");
		expect(html).toContain("<blockquote");
	});
});
