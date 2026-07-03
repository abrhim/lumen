import { describe, it, expect } from "vitest";
import { buildGraphVM, filterVM } from "../graph-model";
import type { NeighborhoodResult } from "@lumen/scripture";

const NEIGHBORHOOD: NeighborhoodResult = {
	found: true,
	center: { id: "1-ne-3-7", name: null, labels: ["Verse"], collection_id: "canon" },
	nodes: [
		{ id: "obedience", name: "Obedience", labels: ["Principle"], collection_id: "phase-b" },
		{ id: "nephi-1", name: "Nephi", labels: ["Person"], collection_id: "phase-b" },
		{ id: "1-ne-4-1", name: "1 Nephi 4:1", labels: ["Verse"], collection_id: "canon" },
	],
	edges: [
		{ from: "1-ne-3-7", to: "obedience", rel_type: "TEACHES", collection_id: "phase-b" },
		{ from: "1-ne-3-7", to: "nephi-1", rel_type: "MENTIONS", collection_id: "phase-b" },
		{ from: "obedience", to: "1-ne-4-1", rel_type: "TEACHES", collection_id: "phase-b" },
	],
	truncated: { shown: 3, total: 3 },
};

describe("filterVM (B5/B6 repro)", () => {
	it("drops hidden types and any edge touching them, keeps the center", () => {
		const vm = buildGraphVM(NEIGHBORHOOD)!;
		const filtered = filterVM(vm, new Set(["Principle"]));
		expect(filtered.nodes.map((n) => n.id)).toEqual(["1-ne-3-7", "nephi-1", "1-ne-4-1"]);
		expect(filtered.edges).toHaveLength(1); // only the MENTIONS edge survives
	});

	it("hiding every type leaves only the center — the all-hidden state the UI must message (B6)", () => {
		const vm = buildGraphVM(NEIGHBORHOOD)!;
		const filtered = filterVM(vm, new Set(["Principle", "Person", "Verse"]));
		expect(filtered.nodes).toHaveLength(1);
		expect(filtered.nodes[0].id).toBe("1-ne-3-7");
		expect(filtered.edges).toHaveLength(0);
	});

	it("is identity when nothing is hidden", () => {
		const vm = buildGraphVM(NEIGHBORHOOD)!;
		expect(filterVM(vm, new Set())).toBe(vm);
	});
});

describe("buildGraphVM", () => {
	it("computes BFS hops and verse targets", () => {
		const vm = buildGraphVM(NEIGHBORHOOD)!;
		expect(vm.center.hop).toBe(0);
		expect(vm.nodes.find((n) => n.id === "1-ne-4-1")?.hop).toBe(2);
		expect(vm.nodes.find((n) => n.id === "1-ne-4-1")?.verseTarget).toEqual({
			book: "1-ne",
			chapter: 4,
			verse: 1,
		});
	});
});
