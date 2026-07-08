import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every data-path function; keep pure helpers (parseReference) real.
vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getVersesByChapter: vi.fn(),
		getChapterSummary: vi.fn(),
		getVerseConnections: vi.fn(),
		getChapterNumbers: vi.fn(),
		// shape MUST match the real contract — an [] here once made every
		// crossRefs path throw-and-degrade while 19/19 tests stayed green (CAPI-1)
		getCrossReferences: vi.fn(async () => ({ refs: [], totals: { outgoing: 0, incoming: 0 } })),
		getWordTags: vi.fn(async () => []),
	};
});

import {
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
	getChapterNumbers,
} from "@lumen/scripture";
import { loader } from "../scripture";

const mockVerses = [
	{ id: "1-ne-3-1", verse_number: 1, text: "And it came to pass...", reference: "1 Nephi 3:1" },
	{ id: "1-ne-3-7", verse_number: 7, text: "I will go and do...", reference: "1 Nephi 3:7" },
];

// getVerseConnections slimmed to entities only — cross-refs moved to Postgres (API-2)
const mockConnections = {
	verse_id: "1-ne-3-7",
	principles: [{ id: "obedience", name: "Obedience" }],
	people: [{ id: "nephi-1", name: "Nephi" }],
};

function kvNoop() {
	return { get: vi.fn(async () => null), put: vi.fn(async () => {}) } as any;
}

function makeArgs(book: string, chapter: string, search = "", cache = kvNoop()) {
	return {
		params: { book, chapter },
		request: new Request(`http://localhost/scripture/${book}/${chapter}${search}`),
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
	vi.mocked(getChapterSummary).mockResolvedValue({ description: "Nephi obtains the plates." } as any);
	vi.mocked(getVerseConnections).mockResolvedValue(mockConnections as any);
	vi.mocked(getChapterNumbers).mockResolvedValue([
		{ chapter_number: 1 }, { chapter_number: 2 }, { chapter_number: 3 },
	] as any);
});

describe("scripture loader — happy paths", () => {
	it("returns verses and summary for a valid chapter", async () => {
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.bookId).toBe("1-ne");
		expect(data.chapter).toBe(3);
		expect(data.verses).toHaveLength(2);
		expect(data.summary).toBe("Nephi obtains the plates.");
		expect(data.connections).toBeNull();
	});

	it("accepts human-style book names in the URL slug (1-nephi is not valid; 1-ne is)", async () => {
		await loader(makeArgs("1-ne", "3"));
		expect(getVersesByChapter).toHaveBeenCalledWith(expect.anything(), "1-ne", 3);
	});

	it("accepts dc even though it parses as a volume (D&C is a single-book volume)", async () => {
		const data = await loader(makeArgs("dc", "4"));
		expect(data.bookId).toBe("dc");
		expect(getVersesByChapter).toHaveBeenCalledWith(expect.anything(), "dc", 4);
	});

	it("streams connections for ?verse=7 as an unawaited promise", async () => {
		const data = await loader(makeArgs("1-ne", "3", "?verse=7"));
		expect(data.selectedVerse).toBe(7);
		expect(data.connections).toBeInstanceOf(Promise);
		const panel = await data.connections!;
		expect(panel.degraded).toBe(false);
		if (!panel.degraded) {
			expect(panel.principles[0].name).toBe("Obedience");
			expect(panel.people[0].name).toBe("Nephi");
		}
		expect(getVerseConnections).toHaveBeenCalledWith(expect.anything(), "1-ne-3-7");
	});

	it("serves connections from cache without calling Neo4j", async () => {
		const kv = { get: vi.fn(async () => JSON.stringify(mockConnections)), put: vi.fn() } as any;
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		const panel = await data.connections!;
		expect(getVerseConnections).not.toHaveBeenCalled();
		expect(panel.degraded).toBe(false);
		if (!panel.degraded) expect(panel.principles[0].id).toBe("obedience");
	});

	it("uses the v2 versioned cache key (payload shape changed with the crossref move, FM-9)", async () => {
		const kv = kvNoop();
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		await data.connections;
		expect(kv.get).toHaveBeenCalledWith(expect.stringMatching(/^vconn:v2:1-ne-3-7$/));
	});

	it("exposes real chapter bounds so the last chapter has no next link (FM-10)", async () => {
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.maxChapter).toBe(3);
	});

	it("fetches cross-refs from Postgres in the CRITICAL PATH for the selected verse — openbible+cross-canon for Bible, legacy for BoM (FM-7/FM-8)", async () => {
		const { getCrossReferences } = await import("@lumen/scripture");
		const args = makeArgs("john", "3", "?verse=16");
		vi.mocked(getVersesByChapter).mockResolvedValue([
			{ id: "john-3-16", verse_number: 16, text: "For God so loved…", reference: "John 3:16" },
		] as any);
		await loader(args);
		// Bible verses query BOTH collections (cross-canon merge, Abram's call)
		expect(vi.mocked(getCrossReferences)).toHaveBeenCalledWith(
			expect.anything(), "john-3-16", expect.objectContaining({ collectionId: "openbible" }),
		);
		expect(vi.mocked(getCrossReferences)).toHaveBeenCalledWith(
			expect.anything(), "john-3-16", expect.objectContaining({ collectionId: "phase-b" }),
		);

		vi.mocked(getCrossReferences as any).mockClear();
		const bomArgs = makeArgs("1-ne", "3", "?verse=7");
		await loader(bomArgs);
		expect(vi.mocked(getCrossReferences)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(getCrossReferences)).toHaveBeenCalledWith(
			expect.anything(), "1-ne-3-7", expect.not.objectContaining({ collectionId: "openbible" }),
		);
	});

	it("delivers non-degraded cards for a Bible verse, keeping only CROSS-CANON legacy refs (CAPI-1 repro + merge)", async () => {
		const { getCrossReferences } = await import("@lumen/scripture");
		const row = (o: Record<string, unknown>) => ({
			verse_id: "heb-11-3", reference: "Hebrews 11:3", text: "Through faith…",
			direction: "outgoing", votes: 271, range_start: null, range_end: null, source: "openbible", ...o,
		});
		vi.mocked(getCrossReferences as any).mockImplementation(async (_db: unknown, _v: string, opts: { collectionId: string }) =>
			opts.collectionId === "openbible"
				? { refs: [row({})], totals: { outgoing: 1, incoming: 0 } }
				: {
						refs: [
							// cross-canon: kept
							row({ verse_id: "ether-12-27", reference: "Ether 12:27", votes: null, source: "anthropic-batch" }),
							// Bible↔Bible legacy: dropped (OpenBible replaces these)
							row({ verse_id: "rom-8-28", reference: "Romans 8:28", votes: null, source: "anthropic-batch" }),
						],
						totals: { outgoing: 2, incoming: 0 },
					},
		);
		vi.mocked(getVersesByChapter).mockResolvedValue([
			{ id: "john-3-16", verse_number: 16, text: "For God so loved…", reference: "John 3:16" },
		] as any);
		const data = await loader(makeArgs("john", "3", "?verse=16"));
		expect(data.crossRefs).not.toBeNull();
		expect(data.crossRefs!.degraded).toBe(false);
		const ids = data.crossRefs!.cards.map((c: { verse_id: string }) => c.verse_id);
		expect(ids).toContain("heb-11-3");
		expect(ids).toContain("ether-12-27");
		expect(ids).not.toContain("rom-8-28");
		expect(data.crossRefs!.totals.outgoing).toBe(2); // 1 openbible + 1 cross-canon
	});

	it("fetches word tags in the critical path for the selected BIBLE verse; happy path asserts real rows (strongs FM-6)", async () => {
		// `as any`: getWordTags doesn't exist until the strongs module lands —
		// this harness test must fail at RUNTIME, not block typecheck (harness-first)
		const { getWordTags } = (await import("@lumen/scripture")) as any;
		vi.mocked(getWordTags as any).mockResolvedValue([
			{ word_id: "john-3-16-w4", position: 4, char_start: 11, char_end: 16, strongs: ["G25"], morph: "robinson:V-AAI-3S", entries: [{ strongs_no: "G25", translit: "agapaō", gloss: "to love" }] },
		]);
		vi.mocked(getVersesByChapter).mockResolvedValue([
			{ id: "john-3-16", verse_number: 16, text: "For God so loved…", reference: "John 3:16" },
		] as any);
		const data = (await loader(makeArgs("john", "3", "?verse=16"))) as any;
		expect(vi.mocked(getWordTags)).toHaveBeenCalledWith(expect.anything(), "john-3-16");
		expect(data.wordTags).not.toBeNull();
		expect(data.wordTags!.degraded).toBe(false);
		expect(data.wordTags!.tags).toHaveLength(1);

		// BoM verses have no tags — the query is skipped entirely
		vi.mocked(getWordTags as any).mockClear();
		await loader(makeArgs("1-ne", "3", "?verse=7"));
		expect(vi.mocked(getWordTags)).not.toHaveBeenCalled();
	});

	it("keeps the per-chapter query count bounded, like the home loader's guard (CPERF-6)", async () => {
		const args = makeArgs("1-ne", "3");
		await loader(args);
		expect(getVersesByChapter).toHaveBeenCalledTimes(1);
		expect(getChapterSummary).toHaveBeenCalledTimes(1);
		expect(getChapterNumbers).toHaveBeenCalledTimes(1);
		// art is the only direct db.execute on a plain chapter view (no ?graph)
		expect(args.context.db.execute).toHaveBeenCalledTimes(1);
		expect(getVerseConnections).not.toHaveBeenCalled();
	});

	it("includes reference on every verse in the loader data", async () => {
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.verses[0].reference).toBe("1 Nephi 3:1");
	});
});

describe("scripture loader — canonical URLs", () => {
	it("301-redirects a non-canonical book slug to the canonical URL, preserving query", async () => {
		let thrown: Response | undefined;
		try {
			await loader(makeArgs("1ne", "3", "?verse=7"));
		} catch (e) {
			thrown = e as Response;
		}
		expect(thrown).toBeDefined();
		expect(thrown!.status).toBe(301);
		expect(thrown!.headers.get("Location")).toBe("/scripture/1-ne/3?verse=7");
	});
});

describe("scripture loader — failure modes", () => {
	it("404s an unknown book slug", async () => {
		await expect(loader(makeArgs("narnia", "1"))).rejects.toMatchObject({ status: 404 });
	});

	it("404s a non-numeric chapter", async () => {
		await expect(loader(makeArgs("1-ne", "abc"))).rejects.toMatchObject({ status: 404 });
	});

	it("404s a chapter with no verses", async () => {
		vi.mocked(getVersesByChapter).mockResolvedValue([] as any);
		await expect(loader(makeArgs("1-ne", "99"))).rejects.toMatchObject({ status: 404 });
	});

	it("degrades gracefully when Neo4j fails: verses intact, panel resolves degraded, no throw", async () => {
		vi.mocked(getVerseConnections).mockRejectedValue(new Error("Neo4j timeout"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = await loader(makeArgs("1-ne", "3", "?verse=7"));
		expect(data.verses).toHaveLength(2);
		const panel = await data.connections!;
		expect(panel.degraded).toBe(true);
		// OBS-1: degradation must not be silent — one structured log line with the event
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("neo4j_degraded"));
		errorSpy.mockRestore();
	});

	it("treats invalid ?verse values as absent", async () => {
		for (const bad of ["?verse=abc", "?verse=-1", "?verse=0"]) {
			const data = await loader(makeArgs("1-ne", "3", bad));
			expect(data.selectedVerse).toBeNull();
			expect(data.connections).toBeNull();
		}
		expect(getVerseConnections).not.toHaveBeenCalled();
	});

	it("treats a ?verse not present in the chapter as absent (no phantom panel)", async () => {
		const data = await loader(makeArgs("1-ne", "3", "?verse=999"));
		expect(data.selectedVerse).toBeNull();
		// The graph fetch is kicked off before the verses arrive (latency overlap),
		// but a verse outside the chapter must still discard the panel promise.
		expect(data.connections).toBeNull();
	});

	it("missing summary renders as null, not an error", async () => {
		vi.mocked(getChapterSummary).mockResolvedValue(null as any);
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.summary).toBeNull();
	});

	it("KV get failure still serves connections from live Neo4j", async () => {
		const kv = { get: vi.fn(async () => { throw new Error("kv down"); }), put: vi.fn(async () => {}) } as any;
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		const panel = await data.connections!;
		expect(panel.degraded).toBe(false);
		if (!panel.degraded) expect(panel.principles).toHaveLength(1);
	});
});
