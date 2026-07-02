import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every data-path function; keep pure helpers (parseReference) real.
vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getVersesByChapter: vi.fn(),
		getChapterSummary: vi.fn(),
		findCrossReferences: vi.fn(),
	};
});

import {
	getVersesByChapter,
	getChapterSummary,
	findCrossReferences,
} from "@lumen/scripture";
import { loader } from "../scripture";

const mockVerses = [
	{ id: "1-ne-3-1", verse_number: 1, text: "And it came to pass...", reference: "1 Nephi 3:1" },
	{ id: "1-ne-3-7", verse_number: 7, text: "I will go and do...", reference: "1 Nephi 3:7" },
];

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
	vi.mocked(findCrossReferences).mockResolvedValue({
		verse_id: "1-ne-3-7",
		cross_reference_count: 1,
		cross_references: [
			{ verse_id: "john-3-16", reference: "John 3:16", text: "For God so loved...", relationship: "CROSS_REF", direction: "outgoing", source: "curated" },
		],
	} as any);
});

describe("scripture loader — happy paths", () => {
	it("returns verses and summary for a valid chapter", async () => {
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.bookId).toBe("1-ne");
		expect(data.chapter).toBe(3);
		expect(data.verses).toHaveLength(2);
		expect(data.summary).toBe("Nephi obtains the plates.");
		expect(data.graphDegraded).toBe(false);
		expect(data.crossRefs).toBeNull();
	});

	it("accepts human-style book names in the URL slug (1-nephi is not valid; 1-ne is)", async () => {
		const data = await loader(makeArgs("1-ne", "3"));
		expect(getVersesByChapter).toHaveBeenCalledWith(expect.anything(), "1-ne", 3);
	});

	it("loads cross-references for ?verse=7", async () => {
		const data = await loader(makeArgs("1-ne", "3", "?verse=7"));
		expect(data.selectedVerse).toBe(7);
		expect(data.crossRefs).toHaveLength(1);
		expect(findCrossReferences).toHaveBeenCalledWith(expect.anything(), "1-ne-3-7");
	});

	it("serves cross-references from cache without calling Neo4j", async () => {
		const cached = {
			verse_id: "1-ne-3-7",
			cross_reference_count: 1,
			cross_references: [{ verse_id: "ps-23-1", reference: "Psalm 23:1", text: "The Lord is my shepherd", relationship: "CROSS_REF", direction: "incoming", source: "curated" }],
		};
		const kv = { get: vi.fn(async () => JSON.stringify(cached)), put: vi.fn() } as any;
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		expect(findCrossReferences).not.toHaveBeenCalled();
		expect(data.crossRefs?.[0].verse_id).toBe("ps-23-1");
	});

	it("uses a versioned cache key built from the canonical verse id", async () => {
		const kv = kvNoop();
		await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		expect(kv.get).toHaveBeenCalledWith(expect.stringMatching(/^xrefs:v1:1-ne-3-7$/));
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

	it("degrades gracefully when Neo4j fails: verses intact, graphDegraded set, no throw", async () => {
		vi.mocked(findCrossReferences).mockRejectedValue(new Error("Neo4j timeout"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const data = await loader(makeArgs("1-ne", "3", "?verse=7"));
		expect(data.verses).toHaveLength(2);
		expect(data.graphDegraded).toBe(true);
		expect(data.crossRefs).toBeNull();
		// OBS-1: degradation must not be silent — one structured log line with the event
		expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("neo4j_degraded"));
		errorSpy.mockRestore();
	});

	it("treats invalid ?verse values as absent", async () => {
		for (const bad of ["?verse=abc", "?verse=-1", "?verse=0"]) {
			const data = await loader(makeArgs("1-ne", "3", bad));
			expect(data.selectedVerse).toBeNull();
			expect(data.crossRefs).toBeNull();
		}
		expect(findCrossReferences).not.toHaveBeenCalled();
	});

	it("missing summary renders as null, not an error", async () => {
		vi.mocked(getChapterSummary).mockResolvedValue(null as any);
		const data = await loader(makeArgs("1-ne", "3"));
		expect(data.summary).toBeNull();
	});

	it("KV get failure still serves cross-refs from live Neo4j", async () => {
		const kv = { get: vi.fn(async () => { throw new Error("kv down"); }), put: vi.fn(async () => {}) } as any;
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		expect(data.crossRefs).toHaveLength(1);
		expect(data.graphDegraded).toBe(false);
	});
});
