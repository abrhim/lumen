import { describe, it, expect } from "vitest";
// Red until implemented: route-layer notes-group merge (plan D3, F9).
import { mergeNotesGroup } from "../notes.server";

const canonGroups = [
	{ key: "scripture", results: [{ id: "alma-32-21" }] },
	{ key: "topics", results: [{ id: "faith" }] },
] as any[];

describe("harness F9/D3 — notes group merges in GROUP_KEYS order, signed-out untouched", () => {
	it("inserts the notes group at position 0 (personal layer leads)", () => {
		const notes = { key: "notes", results: [{ id: "note-1" }] } as any;
		const merged = mergeNotesGroup(canonGroups, notes);
		expect(merged.map((g) => g.key)).toEqual(["notes", "scripture", "topics"]);
	});

	it("an empty notes group prints nothing (register rule)", () => {
		const merged = mergeNotesGroup(canonGroups, { key: "notes", results: [] } as any);
		expect(merged.map((g) => g.key)).toEqual(["scripture", "topics"]);
	});

	it("null notes leg (signed-out) returns canon groups identically — same reference, zero mutation", () => {
		const merged = mergeNotesGroup(canonGroups, null);
		expect(merged).toBe(canonGroups);
	});
});
