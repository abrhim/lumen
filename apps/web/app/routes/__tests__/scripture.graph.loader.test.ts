import { describe, it, expect, vi, beforeEach } from "vitest";

// Harness (graph-view): written before implementation — docs/features/graph-view/plan.md
vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getVersesByChapter: vi.fn(),
		getChapterSummary: vi.fn(),
		getVerseConnections: vi.fn(),
		getNeighborhood: vi.fn(),
		getChapterNumbers: vi.fn(),
		getGraphIdPointer: vi.fn(),
	};
});

import {
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	getNeighborhood,
	getChapterNumbers,
	getGraphIdPointer,
} from "@lumen/scripture";
import { loader } from "../scripture";

const mockVerses = [
	{ id: "1-ne-3-1", verse_number: 1, text: "And it came to pass...", reference: "1 Nephi 3:1" },
	{ id: "1-ne-3-7", verse_number: 7, text: "I will go and do...", reference: "1 Nephi 3:7" },
];

const mockNeighborhood = {
	found: true,
	center: { id: "obedience", name: "Obedience", labels: ["Principle"], collection_id: "phase-b" },
	nodes: [{ id: "1-ne-3-7", name: null, labels: ["Verse"], collection_id: "canon" }],
	edges: [{ from: "obedience", to: "1-ne-3-7", rel_type: "TEACHES", collection_id: "phase-b" }],
	truncated: { shown: 1, total: 1 },
};

function kvNoop() {
	return { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as any;
}

function makeArgs(search = "", cache = kvNoop()) {
	return {
		params: { book: "1-ne", chapter: "3" },
		request: new Request(`http://localhost/scripture/1-ne/3${search}`),
		context: {
			db: { execute: vi.fn() },
			neo4j: { layer: { lumen: { query: vi.fn() } } },
			cache,
			cloudflare: { env: {}, ctx: {} },
		},
	} as any;
}

beforeEach(() => {
	vi.mocked(getVersesByChapter).mockResolvedValue(mockVerses as any);
	vi.mocked(getChapterSummary).mockResolvedValue(null as any);
	vi.mocked(getVerseConnections).mockResolvedValue({
		verse_id: "1-ne-3-7", cross_references: [], principles: [], people: [],
	} as any);
	vi.mocked(getNeighborhood).mockResolvedValue(mockNeighborhood as any);
	vi.mocked(getChapterNumbers).mockResolvedValue([{ chapter_number: 3 }] as any);
	vi.mocked(getGraphIdPointer).mockResolvedValue(null);
});

describe("scripture loader — ?graph param (graph-view harness)", () => {
	it("streams the neighborhood as an unawaited promise for ?graph=<id>", async () => {
		const data = await loader(makeArgs("?graph=obedience&depth=2"));
		expect(data.graph).toBeInstanceOf(Promise);
		const g = await data.graph!;
		expect(g.degraded).toBe(false);
		if (!g.degraded) expect(g.neighborhood.found).toBe(true);
		expect(getNeighborhood).toHaveBeenCalledWith(
			expect.anything(),
			"obedience",
			expect.objectContaining({ depth: 2 }),
		);
	});

	it("returns graph:null when no ?graph param is present", async () => {
		const data = await loader(makeArgs());
		expect(data.graph).toBeNull();
		expect(getNeighborhood).not.toHaveBeenCalled();
	});

	it("clamps out-of-range depth to 1–3 before querying (FM-4)", async () => {
		await loader(makeArgs("?graph=obedience&depth=9"));
		expect(getNeighborhood).toHaveBeenLastCalledWith(
			expect.anything(), "obedience", expect.objectContaining({ depth: 3 }),
		);
		await loader(makeArgs("?graph=obedience&depth=0"));
		expect(getNeighborhood).toHaveBeenLastCalledWith(
			expect.anything(), "obedience", expect.objectContaining({ depth: 1 }),
		);
		await loader(makeArgs("?graph=obedience&depth=abc"));
		expect(getNeighborhood).toHaveBeenLastCalledWith(
			expect.anything(), "obedience", expect.objectContaining({ depth: 1 }),
		);
	});

	it("resolves degraded:true (never rejects) when Neo4j fails (FM-1)", async () => {
		vi.mocked(getNeighborhood).mockRejectedValue(new Error("Aura cold start"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = await loader(makeArgs("?graph=obedience"));
		const g = await data.graph!;
		expect(g.degraded).toBe(true);
		// OBS-1 (synthesis): graph degradation gets its own event, with graph dimensions
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("graph_degraded"));
		errorSpy.mockRestore();
	});

	it("keeps the chapter fully usable alongside an unknown graph entity (FM-3)", async () => {
		vi.mocked(getNeighborhood).mockResolvedValue({
			found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 },
		} as any);
		const data = await loader(makeArgs("?graph=nope"));
		expect(data.verses).toHaveLength(2);
		const g = await data.graph!;
		if (!g.degraded) expect(g.neighborhood.found).toBe(false);
	});

	it("uses a versioned cache key including entity, depth, and collections (FM-7)", async () => {
		const kv = kvNoop();
		const data = await loader(makeArgs("?graph=obedience&depth=2", kv));
		await data.graph;
		// v2 since the 2026-07-21 D&C+PGP spine sync (cache-version invalidation)
		expect(kv.get).toHaveBeenCalledWith(expect.stringMatching(/^graph:v2:obedience:2:/));
	});

	it("composes with ?verse — both panel and graph promises stream independently", async () => {
		const data = await loader(makeArgs("?verse=7&graph=1-ne-3-7&depth=1"));
		expect(data.selectedVerse).toBe(7);
		expect(data.connections).toBeInstanceOf(Promise);
		expect(data.graph).toBeInstanceOf(Promise);
	});

	it("charset-invalid ?graph resolves the overlay's not-found state without querying or caching (B8/B9)", async () => {
		const kv = kvNoop();
		const data = await loader(makeArgs(`?graph=${encodeURIComponent("bad$id!'")}`, kv));
		const g = await data.graph!;
		expect(g.degraded).toBe(false);
		if (!g.degraded) expect(g.neighborhood.found).toBe(false);
		expect(getNeighborhood).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("not-found results are never written to KV — junk ids can't burn the write budget (B9)", async () => {
		vi.mocked(getNeighborhood).mockResolvedValue({
			found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 },
		} as any);
		const kv = kvNoop();
		const data = await loader(makeArgs("?graph=stale-old-id", kv));
		await data.graph;
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("KV cache hits neither re-query nor re-log (B19)", async () => {
		const cachedNeighborhood = { ...mockNeighborhood.nodes, ...{} };
		const kv = {
			get: vi.fn(async () => JSON.stringify({
				found: true,
				center: { id: "obedience", name: "Obedience", labels: ["Principle"], collection_id: "phase-b" },
				nodes: [], edges: [], truncated: { shown: 5, total: 500 },
			})),
			put: vi.fn(async () => {}),
		} as any;
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = await loader(makeArgs("?graph=obedience&depth=2", kv));
		const g = await data.graph!;
		expect(g.degraded).toBe(false);
		expect(getNeighborhood).not.toHaveBeenCalled();
		expect(kv.put).not.toHaveBeenCalled();
		const graphLogs = errorSpy.mock.calls.filter((c) => String(c[0]).includes("graph_"));
		expect(graphLogs).toHaveLength(0);
		errorSpy.mockRestore();
	});

	it("resolves namespaced ids via metadata.neo4j_id on a miss (DATA-1 contract)", async () => {
		vi.mocked(getNeighborhood)
			.mockResolvedValueOnce({
				found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 },
			} as any)
			.mockResolvedValueOnce(mockNeighborhood as any);
		vi.mocked(getGraphIdPointer).mockResolvedValue("moses-1");
		const kv = kvNoop();
		const data = await loader(makeArgs("?graph=person:moses-1&depth=2", kv));
		const g = await data.graph!;
		expect(g.degraded).toBe(false);
		if (!g.degraded) expect(g.neighborhood.found).toBe(true);
		expect(getNeighborhood).toHaveBeenNthCalledWith(
			1, expect.anything(), "person:moses-1", expect.objectContaining({ depth: 2 }),
		);
		expect(getNeighborhood).toHaveBeenNthCalledWith(
			2, expect.anything(), "moses-1", expect.objectContaining({ depth: 2 }),
		);
		// cached under the REQUESTED id — the link space uses PG ids
		expect(kv.put).toHaveBeenCalledWith(
			expect.stringMatching(/^graph:v2:person:moses-1:2:/), expect.any(String), expect.anything(),
		);
	});

	it("no pointer → single query, stays not-found, never caches (art class)", async () => {
		vi.mocked(getNeighborhood).mockResolvedValue({
			found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 },
		} as any);
		const kv = kvNoop();
		const data = await loader(makeArgs("?graph=art:some-piece", kv));
		const g = await data.graph!;
		if (!g.degraded) expect(g.neighborhood.found).toBe(false);
		expect(getNeighborhood).toHaveBeenCalledTimes(1);
		expect(getGraphIdPointer).toHaveBeenCalledTimes(1);
		expect(kv.put).not.toHaveBeenCalled();
	});

	it("a failing pointer lookup degrades to not-found, never rejects", async () => {
		vi.mocked(getNeighborhood).mockResolvedValue({
			found: false, center: null, nodes: [], edges: [], truncated: { shown: 0, total: 0 },
		} as any);
		vi.mocked(getGraphIdPointer).mockRejectedValue(new Error("pool exhausted"));
		const data = await loader(makeArgs("?graph=person:moses-1"));
		const g = await data.graph!;
		expect(g.degraded).toBe(false);
		if (!g.degraded) expect(g.neighborhood.found).toBe(false);
	});

	it("found on first try never touches PG (hot path stays Neo4j+KV)", async () => {
		await loader(makeArgs("?graph=obedience")).then((d) => d.graph);
		expect(getGraphIdPointer).not.toHaveBeenCalled();
	});

	it("graph logs carry elapsedMs and full dimensions (B19/OBS-1)", async () => {
		vi.mocked(getNeighborhood).mockRejectedValue(new Error("boom"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = await loader(makeArgs("?graph=obedience&depth=2"));
		await data.graph;
		const line = errorSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes("graph_degraded"));
		expect(line).toBeDefined();
		const parsed = JSON.parse(line!);
		expect(parsed).toMatchObject({ entityId: "obedience", depth: 2 });
		expect(typeof parsed.elapsedMs).toBe("number");
		errorSpy.mockRestore();
	});
});
