import type { NeighborhoodResult, NeighborhoodNode } from "@lumen/scripture";
import { parseReference } from "@lumen/scripture";

/** Plain-language legend labels (UX-8) and paper-contrast-checked colors (A11Y-9). */
export const TYPE_META: Record<string, { label: string; color: string }> = {
	Verse: { label: "Verse", color: "#7c4a2d" },
	Principle: { label: "Principle", color: "#8a5a1f" },
	Person: { label: "Person", color: "#2f6f5e" },
	Place: { label: "Place", color: "#9a4526" },
	Symbol: { label: "Symbol", color: "#80395f" },
	NaveTopic: { label: "Topic", color: "#3a4a7a" },
	Era: { label: "Time period", color: "#5a4a7a" },
	Event: { label: "Event", color: "#8a3a3a" },
	Chapter: { label: "Chapter", color: "#776a57" },
	Book: { label: "Book", color: "#776a57" },
	Volume: { label: "Volume", color: "#776a57" },
	ChapterSummary: { label: "Summary", color: "#776a57" },
};

export const FALLBACK_TYPE = { label: "Other", color: "#776a57" };

export function primaryType(labels: string[]): string {
	return labels.find((l) => TYPE_META[l]) ?? labels[0] ?? "Other";
}

export interface GraphNodeVM {
	id: string;
	label: string;
	type: string;
	color: string;
	hop: number; // BFS distance from center (0 = center)
	collection_id: string | null;
	verseTarget: { book: string; chapter: number; verse: number } | null;
}

export interface GraphEdgeVM {
	from: string;
	to: string;
	rel_type: string;
}

export interface GraphVM {
	center: GraphNodeVM;
	nodes: GraphNodeVM[]; // includes center at index 0
	edges: GraphEdgeVM[];
	adjacency: Map<string, Set<string>>;
	types: { type: string; label: string; color: string; count: number }[];
}

function verseTargetOf(n: NeighborhoodNode) {
	if (!n.labels.includes("Verse")) return null;
	const parsed = parseReference(n.id);
	if (parsed.level !== "verse" || !parsed.bookId || !parsed.chapter || !parsed.verse) return null;
	return { book: parsed.bookId, chapter: parsed.chapter, verse: parsed.verse };
}

function toVM(n: NeighborhoodNode, hop: number): GraphNodeVM {
	const type = primaryType(n.labels);
	const meta = TYPE_META[type] ?? FALLBACK_TYPE;
	return {
		id: n.id,
		label: n.name ?? n.id,
		type,
		color: meta.color,
		hop,
		collection_id: n.collection_id,
		verseTarget: verseTargetOf(n),
	};
}

/**
 * Build the render model: BFS hop distances from the center (drives radial
 * rings, list grouping, and force seeding), adjacency for hover-dimming, and
 * the per-type legend.
 */
export function buildGraphVM(neighborhood: NeighborhoodResult): GraphVM | null {
	if (!neighborhood.found || !neighborhood.center) return null;

	const adjacency = new Map<string, Set<string>>();
	const link = (a: string, b: string) => {
		if (!adjacency.has(a)) adjacency.set(a, new Set());
		adjacency.get(a)!.add(b);
	};
	for (const e of neighborhood.edges) {
		link(e.from, e.to);
		link(e.to, e.from);
	}

	// BFS from center over the returned edge set
	const hops = new Map<string, number>([[neighborhood.center.id, 0]]);
	let frontier = [neighborhood.center.id];
	while (frontier.length > 0) {
		const next: string[] = [];
		for (const id of frontier) {
			for (const nb of adjacency.get(id) ?? []) {
				if (!hops.has(nb)) {
					hops.set(nb, (hops.get(id) ?? 0) + 1);
					next.push(nb);
				}
			}
		}
		frontier = next;
	}

	const center = toVM(neighborhood.center, 0);
	const nodes = [
		center,
		...neighborhood.nodes
			.filter((n) => n.id !== neighborhood.center!.id)
			.map((n) => toVM(n, hops.get(n.id) ?? 1)),
	];

	const counts = new Map<string, number>();
	for (const n of nodes.slice(1)) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
	const types = [...counts.entries()]
		.map(([type, count]) => ({
			type,
			label: (TYPE_META[type] ?? FALLBACK_TYPE).label,
			color: (TYPE_META[type] ?? FALLBACK_TYPE).color,
			count,
		}))
		.sort((a, b) => b.count - a.count);

	return {
		center,
		nodes,
		edges: neighborhood.edges.map((e) => ({ from: e.from, to: e.to, rel_type: e.rel_type })),
		adjacency,
		types,
	};
}

/** Above these sizes the force simulation is too heavy — fall back to radial (PERF-7, B4). */
export const FORCE_NODE_LIMIT = 220;
export const FORCE_EDGE_LIMIT = 800;

/**
 * Client-side type filter (legend toggles). Center always survives. Pure so
 * the all-hidden state is testable (B6); ForceLayout intentionally does NOT
 * consume this — it hides elements via refs to keep the simulation stable (B5).
 */
export function filterVM(vm: GraphVM, hiddenTypes: ReadonlySet<string>): GraphVM {
	if (hiddenTypes.size === 0) return vm;
	const keep = new Set(
		vm.nodes.filter((n) => n.hop === 0 || !hiddenTypes.has(n.type)).map((n) => n.id),
	);
	return {
		...vm,
		nodes: vm.nodes.filter((n) => keep.has(n.id)),
		edges: vm.edges.filter((e) => keep.has(e.from) && keep.has(e.to)),
	};
}
