import { describe, it, expect } from "vitest";
import { suggestDestinations } from "~/components/editor/suggest";
import { renderNoteHtml } from "../notes-render.server";
import { mergeLinkedNotes, type LinkedCanon } from "../notes-linked.server";
import { lumenUrlToRef } from "~/components/editor/lumen-url";

/** Note-to-note linking (Abram, 2026-07-31). */

const A = "6a296036-5fe5-46e5-944d-93ef616f2b94";
const B = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";

const emptyLinked = (): LinkedCanon => ({
	verses: [],
	chapters: [],
	entities: [],
	media: [],
	notes: [],
	previews: {},
});

describe("suggestDestinations notes leg", () => {
	const index: Array<[string, string]> = [
		[A, "Faith is a seed"],
		[B, "On faith and charity"],
	];

	it("offers the writer's notes by title, prefix first", () => {
		const out = suggestDestinations("faith", index);
		const notes = out.filter((s) => s.kind === "note");
		expect(notes.map((s) => s.ref)).toEqual([`note:${A}`, `note:${B}`]);
		expect(notes[0].display).toBe("Faith is a seed");
		expect(notes[0].path).toBe(`/notes/${A}`);
		expect(notes[0].gloss).toBe("note");
	});

	it("requires every query word", () => {
		const out = suggestDestinations("charity faith", index);
		const notes = out.filter((s) => s.kind === "note");
		expect(notes.map((s) => s.ref)).toEqual([`note:${B}`]);
	});

	it("offers nothing without an index (and never in chapter drills)", () => {
		expect(suggestDestinations("faith").some((s) => s.kind === "note")).toBe(false);
		expect(suggestDestinations("alma 3", index).some((s) => s.kind === "note")).toBe(false);
	});
});

describe("note wikilink rendering", () => {
	it("renders a real link to /notes/<id> with the label as its name", () => {
		const html = renderNoteHtml(`see [[note:${A}|Faith is a seed]]`);
		expect(html).toContain(`href="/notes/${A}"`);
		expect(html).toContain(">Faith is a seed</a>");
		// the label IS the accessible name — no "— note:<uuid>" aria suffix
		expect(html).not.toContain("aria-label");
	});

	it("fails closed on malformed note refs", () => {
		const html = renderNoteHtml("see [[note:evil|x]]");
		expect(html).toContain("note-wikilink-dead");
		expect(html).not.toContain("href=");
	});
});

describe("mergeLinkedNotes", () => {
	it("merges rows in ref order and feeds the hover previews", () => {
		const linked = emptyLinked();
		mergeLinkedNotes(
			linked,
			[`note:${B}`, `note:${A}`],
			[
				{ id: A, title_line: "Faith is a seed", snippet: "planted in the heart" },
				{ id: B, title_line: null, snippet: null },
			],
		);
		expect(linked.notes.map((n) => n.title)).toEqual(["Untitled note", "Faith is a seed"]);
		expect(linked.notes[1].href).toBe(`/notes/${A}`);
		expect(linked.previews[`note:${A}`]).toEqual({
			title: "Faith is a seed",
			snippet: "planted in the heart",
			href: `/notes/${A}`,
		});
	});

	it("a missing row (foreign or deleted uuid) is absence, never an error", () => {
		const linked = emptyLinked();
		mergeLinkedNotes(linked, [`note:${A}`], []);
		expect(linked.notes).toEqual([]);
		expect(linked.previews).toEqual({});
	});
});

describe("pasted note URLs", () => {
	it("converts /notes/<uuid> on our origin into a note ref", () => {
		expect(lumenUrlToRef(`https://lumen.abramhimmer.workers.dev/notes/${A}`, "https://lumen.abramhimmer.workers.dev")).toBe(
			`note:${A}`,
		);
	});
	it("rejects /notes/new and junk ids", () => {
		expect(
			lumenUrlToRef("https://lumen.abramhimmer.workers.dev/notes/new", "https://lumen.abramhimmer.workers.dev"),
		).toBeNull();
	});
});
