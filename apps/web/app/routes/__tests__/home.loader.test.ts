import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...actual,
		getVolumeList: vi.fn(),
		getAllBooks: vi.fn(),
	};
});

import { getVolumeList, getAllBooks } from "@lumen/scripture";
import { loader } from "../home";

beforeEach(() => {
	vi.mocked(getVolumeList).mockResolvedValue([
		{ id: "bom", name: "Book of Mormon", metadata: { sort_order: 3 } },
		{ id: "ot", name: "Old Testament", metadata: { sort_order: 1 } },
	] as any);
	vi.mocked(getAllBooks).mockResolvedValue([
		{ id: "1-ne", name: "1 Nephi", volume_id: "bom", sort_order: 68 },
		{ id: "gen", name: "Genesis", volume_id: "ot", sort_order: 1 },
	] as any);
});

describe("home loader", () => {
	it("returns volumes ordered by metadata.sort_order with their books, in 2 queries", async () => {
		const data = await loader({
			params: {},
			request: new Request("http://localhost/"),
			context: { db: {}, cloudflare: { env: {}, ctx: {} } },
		} as any);
		expect(data.volumes.map((v: any) => v.id)).toEqual(["ot", "bom"]);
		expect(data.volumes[0].books[0].id).toBe("gen");
		expect(data.volumes[1].books[0].id).toBe("1-ne");
		// PERF-1: exactly one volumes query + one books query — no per-volume fan-out
		expect(getVolumeList).toHaveBeenCalledTimes(1);
		expect(getAllBooks).toHaveBeenCalledTimes(1);
	});
});
