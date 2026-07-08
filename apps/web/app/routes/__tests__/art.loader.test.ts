import { describe, it, expect, vi, beforeEach } from "vitest";

// Harness (art-graph): gallery route loader + card-stack pure helper.
vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getChapterArt: vi.fn(),
		getChapterArtCount: vi.fn(async () => 2),
		getBook: vi.fn(async () => ({ name: "Luke" })),
	};
});

import { getChapterArt } from "@lumen/scripture";
import { loader } from "../scripture.art";
import { pickArtStack } from "../../lib/art";

const work = (id: string, fame: number | null) => ({
	id: `art:${id}`,
	name: id,
	metadata: { artist_name: "A", year: 1600, image_url: `https://x/${id}.jpg`, source_url: `https://y/${id}`, fame, refs: [] },
});

function makeArgs(book: string, chapter: string) {
	return {
		params: { book, chapter },
		request: new Request(`http://localhost/scripture/${book}/${chapter}/art`),
		context: { db: { execute: vi.fn() } },
	} as any;
}

beforeEach(() => {
	vi.mocked(getChapterArt).mockResolvedValue([work("a", 9), work("b", 5)] as any);
});

describe("gallery loader (FM-6)", () => {
	it("returns fame-ranked art for a valid chapter — happy path asserted, not just shape (tske B2 lesson)", async () => {
		const data = await loader(makeArgs("luke", "2"));
		expect(data.art).toHaveLength(2);
		expect(data.art[0].id).toBe("art:a");
		expect(data.bookId).toBe("luke");
		expect(data.chapter).toBe(2);
		expect(data.reference).toBe("Luke 2"); // human name, never the slug (CUO-1)
		expect(data.total).toBe(2);
		expect(data.totalPages).toBe(1);
		expect(getChapterArt).toHaveBeenCalledWith(expect.anything(), "luke", 2, 24, 0); // page 1, 24/page
	});

	it("404s an unknown book and a non-numeric chapter", async () => {
		await expect(loader(makeArgs("narnia", "1"))).rejects.toMatchObject({ status: 404 });
		await expect(loader(makeArgs("luke", "abc"))).rejects.toMatchObject({ status: 404 });
	});

	it("empty art is an empty state, not an error", async () => {
		vi.mocked(getChapterArt).mockResolvedValue([] as any);
		const data = await loader(makeArgs("gen", "1"));
		expect(data.art).toEqual([]);
		expect(data.degraded).toBe(false);
	});

	it("301-redirects alias book slugs like the sibling chapter route (API-4)", async () => {
		let thrown: Response | undefined;
		try {
			await loader(makeArgs("1ne", "3"));
		} catch (e) {
			thrown = e as Response;
		}
		expect(thrown?.status).toBe(301);
		expect(thrown?.headers.get("Location")).toBe("/scripture/1-ne/3/art");
	});

	it("degrades (never throws) when getChapterArt fails — distinct from empty (OBS-4)", async () => {
		vi.mocked(getChapterArt).mockRejectedValue(new Error("pg down"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const data = await loader(makeArgs("luke", "2"));
		expect(data.degraded).toBe(true);
		expect(data.art).toEqual([]);
		const logged = [...errorSpy.mock.calls, ...logSpy.mock.calls].flat().join(" ");
		expect(logged).toContain("art_gallery_degraded");
		errorSpy.mockRestore();
		logSpy.mockRestore();
	});
});

describe("safeHttpUrl (SEC-1/SEC-2)", () => {
	it("passes http(s), rejects javascript:/data:/relative/empty", async () => {
		const { safeHttpUrl } = await import("../../lib/art");
		expect(safeHttpUrl("https://x.org/a.jpg")).toBe("https://x.org/a.jpg");
		expect(safeHttpUrl("http://x.org")).toBe("http://x.org");
		// eslint-disable-next-line no-script-url
		expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
		expect(safeHttpUrl("data:text/html,x")).toBeNull();
		expect(safeHttpUrl("//x.org/a.jpg")).toBeNull();
		expect(safeHttpUrl("")).toBeNull();
		expect(safeHttpUrl(null)).toBeNull();
	});
});

describe("pickArtStack (FM-7)", () => {
	it("returns the top-N by fame plus the overflow count", () => {
		const items = [
			{ id: "1", fame: 3 }, { id: "2", fame: 9 }, { id: "3", fame: null },
			{ id: "4", fame: 7 }, { id: "5", fame: 1 },
		];
		const { stack, more } = pickArtStack(items as any, 3);
		expect(stack.map((s: any) => s.id)).toEqual(["2", "4", "1"]);
		expect(more).toBe(2);
	});

	it("handles fewer items than the stack size", () => {
		const { stack, more } = pickArtStack([{ id: "1", fame: null }] as any, 3);
		expect(stack).toHaveLength(1);
		expect(more).toBe(0);
	});
});
