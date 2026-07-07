import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getChapterNumbers: vi.fn(),
		getBook: vi.fn(),
	};
});

import { getChapterNumbers, getBook } from "@lumen/scripture";
import { loader } from "../book";

function makeArgs(book: string) {
	return {
		params: { book },
		request: new Request(`http://localhost/scripture/${book}`),
		context: { db: { execute: vi.fn() }, cloudflare: { env: {}, ctx: {} } },
	} as any;
}

beforeEach(() => {
	vi.mocked(getChapterNumbers).mockResolvedValue([
		{ chapter_number: 1 },
		{ chapter_number: 2 },
		{ chapter_number: 3 },
	] as any);
	vi.mocked(getBook).mockResolvedValue({ id: "1-ne", name: "1 Nephi" } as any);
});

describe("book loader", () => {
	it("returns the ordered chapter list and book name", async () => {
		const data = await loader(makeArgs("1-ne"));
		expect(data).toEqual({ bookId: "1-ne", name: "1 Nephi", chapters: [1, 2, 3] });
	});

	it("accepts dc (single-book volume) like the chapter route does", async () => {
		vi.mocked(getBook).mockResolvedValue({ id: "dc", name: "Doctrine and Covenants" } as any);
		const data = await loader(makeArgs("dc"));
		expect(data.bookId).toBe("dc");
		expect(getChapterNumbers).toHaveBeenCalledWith(expect.anything(), "dc");
	});

	it("301-redirects alias slugs to the canonical book URL", async () => {
		let thrown: Response | undefined;
		try {
			await loader(makeArgs("1ne"));
		} catch (e) {
			thrown = e as Response;
		}
		expect(thrown!.status).toBe(301);
		expect(thrown!.headers.get("Location")).toBe("/scripture/1-ne");
	});

	it("404s unknown books and books with no chapters", async () => {
		await expect(loader(makeArgs("narnia"))).rejects.toMatchObject({ status: 404 });
		vi.mocked(getChapterNumbers).mockResolvedValue([] as any);
		await expect(loader(makeArgs("1-ne"))).rejects.toMatchObject({ status: 404 });
	});

	it("falls back to the book id when no entity name exists", async () => {
		vi.mocked(getBook).mockResolvedValue(null as any);
		const data = await loader(makeArgs("1-ne"));
		expect(data.name).toBe("1-ne");
	});
});
