import { describe, it, expect } from "vitest";
// Red until implemented: route-layer notes-group merge (plan A4, F9).
// CF-1: notes is a ROUTE-LAYER key — GROUP_KEYS stays frozen; the merged
// response order is SEARCH_RESPONSE_KEYS = [notes, ...GROUP_KEYS].
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

	it("harness gap 15: canon groups already containing a notes key never double it", () => {
		const poisoned = [{ key: "notes", results: [{ id: "x" }] }, ...canonGroups] as any[];
		const merged = mergeNotesGroup(poisoned, { key: "notes", results: [{ id: "note-1" }] } as any);
		expect(merged.filter((g) => g.key === "notes")).toHaveLength(1);
	});

	it("A4: a degraded notes leg keeps the group present with degraded:true, canon untouched", () => {
		const merged = mergeNotesGroup(canonGroups, {
			key: "notes",
			results: [],
			degraded: true,
		} as any);
		expect(merged[0]).toMatchObject({ key: "notes", degraded: true });
		expect(merged.slice(1)).toEqual(canonGroups);
	});
});
