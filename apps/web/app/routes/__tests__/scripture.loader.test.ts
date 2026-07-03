import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock every data-path function; keep pure helpers (parseReference) real.
vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getVersesByChapter: vi.fn(),
		getChapterSummary: vi.fn(),
		getVerseConnections: vi.fn(),
	};
});

import {
	getVersesByChapter,
	getChapterSummary,
	getVerseConnections,
} from "@lumen/scripture";
import { loader } from "../scripture";

const mockVerses = [
	{ id: "1-ne-3-1", verse_number: 1, text: "And it came to pass...", reference: "1 Nephi 3:1" },
	{ id: "1-ne-3-7", verse_number: 7, text: "I will go and do...", reference: "1 Nephi 3:7" },
];

const mockConnections = {
	verse_id: "1-ne-3-7",
	cross_references: [
		{ verse_id: "john-3-16", reference: "John 3:16", text: "For God so loved...", relationship: "CROSS_REF", direction: "outgoing", source: "curated" },
	],
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
			expect(panel.crossRefs).toHaveLength(1);
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
		if (!panel.degraded) expect(panel.crossRefs[0].verse_id).toBe("john-3-16");
	});

	it("uses a versioned cache key built from the canonical verse id", async () => {
		const kv = kvNoop();
		const data = await loader(makeArgs("1-ne", "3", "?verse=7", kv));
		await data.connections;
		expect(kv.get).toHaveBeenCalledWith(expect.stringMatching(/^vconn:v1:1-ne-3-7$/));
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
		if (!panel.degraded) expect(panel.crossRefs).toHaveLength(1);
	});
});
