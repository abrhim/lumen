import { describe, it, expect, vi } from "vitest";
import { cachedJson } from "../cache.server";

function kvWith(overrides: Partial<{ get: any; put: any }> = {}) {
	return {
		get: vi.fn(async () => null),
		put: vi.fn(async () => {}),
		...overrides,
	} as any;
}

describe("cachedJson", () => {
	it("cache hit: returns stored value without calling fetcher", async () => {
		const kv = kvWith({ get: vi.fn(async () => JSON.stringify({ hello: 1 })) });
		const fetcher = vi.fn(async () => ({ hello: 2 }));
		const result = await cachedJson(kv, "k", 60, fetcher);
		expect(result).toEqual({ hello: 1 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("cache miss: calls fetcher and writes with the given TTL", async () => {
		const kv = kvWith();
		const fetcher = vi.fn(async () => ({ fresh: true }));
		const result = await cachedJson(kv, "k", 604800, fetcher);
		expect(result).toEqual({ fresh: true });
		expect(kv.put).toHaveBeenCalledWith(
			"k",
			JSON.stringify({ fresh: true }),
			expect.objectContaining({ expirationTtl: 604800 }),
		);
	});

	it("kv.get throws: falls through to fetcher", async () => {
		const kv = kvWith({ get: vi.fn(async () => { throw new Error("kv down"); }) });
		const fetcher = vi.fn(async () => ({ live: true }));
		await expect(cachedJson(kv, "k", 60, fetcher)).resolves.toEqual({ live: true });
	});

	it("kv.put throws: result still returned", async () => {
		const kv = kvWith({ put: vi.fn(async () => { throw new Error("kv down"); }) });
		const fetcher = vi.fn(async () => ({ live: true }));
		await expect(cachedJson(kv, "k", 60, fetcher)).resolves.toEqual({ live: true });
	});

	it("kv undefined: calls fetcher directly", async () => {
		const fetcher = vi.fn(async () => 42);
		await expect(cachedJson(undefined, "k", 60, fetcher)).resolves.toBe(42);
	});

	it("corrupt cached JSON: falls through to fetcher", async () => {
		const kv = kvWith({ get: vi.fn(async () => "{not json") });
		const fetcher = vi.fn(async () => ({ live: true }));
		await expect(cachedJson(kv, "k", 60, fetcher)).resolves.toEqual({ live: true });
	});
});
