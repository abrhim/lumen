import { describe, it, expect } from "vitest";
import { buildGraphVM, filterVM, clusterVerses, VERSE_CLUSTER_PREFIX } from "../graph-model";
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

// An entity fanning out to many verses of the same chapter — the overwhelm
// case chapter clustering exists for.
const VERSE_FAN: NeighborhoodResult = {
	found: true,
	center: { id: "obedience", name: "Obedience", labels: ["Principle"], collection_id: "phase-b" },
	nodes: [
		{ id: "1-ne-4-1", name: "1 Nephi 4:1", labels: ["Verse"], collection_id: "canon" },
		{ id: "1-ne-4-2", name: "1 Nephi 4:2", labels: ["Verse"], collection_id: "canon" },
		{ id: "1-ne-4-38", name: "1 Nephi 4:38", labels: ["Verse"], collection_id: "canon" },
		{ id: "1-ne-5-1", name: "1 Nephi 5:1", labels: ["Verse"], collection_id: "canon" },
		{ id: "nephi-1", name: "Nephi", labels: ["Person"], collection_id: "phase-b" },
	],
	edges: [
		{ from: "obedience", to: "1-ne-4-1", rel_type: "TEACHES", collection_id: "phase-b" },
		{ from: "obedience", to: "1-ne-4-2", rel_type: "TEACHES", collection_id: "phase-b" },
		{ from: "obedience", to: "1-ne-4-38", rel_type: "TEACHES", collection_id: "phase-b" },
		{ from: "obedience", to: "1-ne-5-1", rel_type: "TEACHES", collection_id: "phase-b" },
		{ from: "1-ne-4-1", to: "1-ne-4-2", rel_type: "NEXT", collection_id: "canon" },
		{ from: "1-ne-4-1", to: "nephi-1", rel_type: "MENTIONS", collection_id: "phase-b" },
	],
	truncated: { shown: 5, total: 5 },
};

describe("clusterVerses (chapter altitude)", () => {
	const CLUSTER_ID = `${VERSE_CLUSTER_PREFIX}1-ne-4`;

	it("collapses same-chapter verses into one counted node; single-verse chapters stay loose", () => {
		const vm = clusterVerses(buildGraphVM(VERSE_FAN)!, new Set());
		const cluster = vm.nodes.find((n) => n.id === CLUSTER_ID);
		expect(cluster).toMatchObject({ label: "1 Nephi 4 · 3 verses", type: "VerseCluster", verseTarget: null });
		expect(vm.nodes.map((n) => n.id)).not.toContain("1-ne-4-1");
		expect(vm.nodes.map((n) => n.id)).toContain("1-ne-5-1"); // alone in its chapter
		expect(vm.nodes[0].id).toBe("obedience"); // center stays at index 0
	});

	it("rewires edges to the cluster, dedups, and drops intra-cluster edges; adjacency rebuilt", () => {
		const vm = clusterVerses(buildGraphVM(VERSE_FAN)!, new Set());
		const teaches = vm.edges.filter((e) => e.to === CLUSTER_ID && e.rel_type === "TEACHES");
		expect(teaches).toHaveLength(1); // three verse edges → one cluster edge
		expect(vm.edges.some((e) => e.rel_type === "NEXT")).toBe(false); // intra-cluster collapses away
		expect(vm.edges).toContainEqual({ from: CLUSTER_ID, to: "nephi-1", rel_type: "MENTIONS" });
		expect(vm.adjacency.get(CLUSTER_ID)).toEqual(new Set(["obedience", "nephi-1"]));
		expect(vm.types.find((t) => t.type === "VerseCluster")).toMatchObject({ label: "Verse group", count: 1 });
	});

	it("an expanded cluster renders its verses loose; all-expanded is the identity", () => {
		const base = buildGraphVM(VERSE_FAN)!;
		const vm = clusterVerses(base, new Set([CLUSTER_ID]));
		expect(vm).toBe(base); // only one clusterable chapter — expanding it is identity
	});

	it("a verse center is never clustered", () => {
		const vm = clusterVerses(buildGraphVM(NEIGHBORHOOD)!, new Set());
		expect(vm.nodes[0].id).toBe("1-ne-3-7");
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
