/**
 * search-ui harness — /api/search cursor contract (F2, F3, F4, F5 endpoint side).
 * RED-FIRST: the `after` param and cursor codes do not exist yet.
 * F1 (live keyset continuity) lives in packages/scripture search-cursor harness.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GROUP_KEYS, type SearchResponse } from "@lumen/scripture";

vi.mock("@lumen/scripture", async (importOriginal) => {
	const real = await importOriginal<typeof import("@lumen/scripture")>();
	return {
		...real,
		searchAll: vi.fn(),
		getPublicCollectionIds: vi.fn().mockResolvedValue(["phase-b"]),
		// RED: encodeSearchCursor export does not exist yet.
		encodeSearchCursor: real.encodeSearchCursor,
	};
});
vi.mock("~/lib/auth.server", () => ({
	getSessionUser: vi.fn().mockResolvedValue({ user: null, headers: new Headers() }),
}));
vi.mock("~/lib/log.server", () => ({ logEvent: vi.fn() }));

import { searchAll, encodeSearchCursor } from "@lumen/scripture";
import { loader } from "../api.search";

// Δ ACU-3: `satisfies`, never a cast — mock drift against the real response
// type breaks typecheck instead of silently pinning a stale shape (harness-
// origin bugs are the top provenance class).
const EMPTY = {
	query: "faith",
	reference: null,
	groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
	meta: {
		perGroup: Object.fromEntries(GROUP_KEYS.map((k) => [k, { ms: null, hits: 0 }])),
		totalMs: 5,
		mode: "combined",
	},
} satisfies SearchResponse;

function makeArgs(qs: string) {
	const db = { execute: vi.fn().mockResolvedValue([]) };
	return {
		request: new Request(`https://lumen.test/api/search${qs}`),
		context: { db, cloudflare: { env: {} } },
		params: {},
	} as any;
}

beforeEach(() => {
	vi.mocked(searchAll).mockReset().mockResolvedValue(structuredClone(EMPTY));
});

async function code(qs: string): Promise<{ status: number; code?: string }> {
	const res = (await loader(makeArgs(qs))) as Response;
	const body = (await res.json()) as { code?: string };
	return { status: res.status, code: body.code };
}

describe("F2 — cursor requires exactly one scope group", () => {
	it("after with no scope → 400 cursor_scope", async () => {
		const c = encodeSearchCursor({ q: "faith", scope: "scripture", tier: 3, score: 1.2, id: "x" });
		expect(await code(`?q=faith&after=${c}`)).toEqual({ status: 400, code: "cursor_scope" });
	});
	it("after with two scope groups → 400 cursor_scope", async () => {
		const c = encodeSearchCursor({ q: "faith", scope: "scripture", tier: 3, score: 1.2, id: "x" });
		expect(await code(`?q=faith&scope=scripture,people&after=${c}`)).toEqual({
			status: 400,
			code: "cursor_scope",
		});
	});
});

describe("F3 — malformed cursors never 500 and are never echoed", () => {
	for (const bad of ["garbage", "AAAA%00", "e30", "x".repeat(500)]) {
		it(`after=${bad.slice(0, 12)} → 400 cursor_invalid`, async () => {
			const res = (await loader(makeArgs(`?q=faith&scope=scripture&after=${bad}`))) as Response;
			expect(res.status).toBe(400);
			const body = (await res.json()) as { code?: string; error?: string };
			expect(body.code).toBe("cursor_invalid");
			expect(body.error).not.toContain(bad.slice(0, 8));
		});
	}
});

describe("F4 — cursor is bound to (q, scope)", () => {
	it("cursor minted for another q → 400 cursor_mismatch", async () => {
		const c = encodeSearchCursor({ q: "hope", scope: "scripture", tier: 3, score: 1.2, id: "x" });
		expect(await code(`?q=faith&scope=scripture&after=${c}`)).toEqual({
			status: 400,
			code: "cursor_mismatch",
		});
	});
	it("cursor minted for another scope group → 400 cursor_mismatch", async () => {
		const c = encodeSearchCursor({ q: "faith", scope: "people", tier: 3, score: 1.2, id: "x" });
		expect(await code(`?q=faith&scope=scripture&after=${c}`)).toEqual({
			status: 400,
			code: "cursor_mismatch",
		});
	});
});

describe("F5 — nextCursor passthrough", () => {
	it("group nextCursor from searchAll reaches the response body verbatim", async () => {
		// Δ ACU-3 + RED-FIRST: `satisfies` fails typecheck until SearchGroup
		// gains the optional additive `nextCursor` — that failure IS the contract
		// pin; it clears in the same commit that ships the field.
		const withCursor = {
			...structuredClone(EMPTY),
			groups: [{ key: "scripture", results: [], nextCursor: "opaque123" }],
		} satisfies SearchResponse;
		vi.mocked(searchAll).mockResolvedValueOnce(withCursor);
		const res = (await loader(makeArgs("?q=faith&scope=scripture"))) as Response;
		const body = (await res.json()) as any;
		expect(body.groups[0].nextCursor).toBe("opaque123");
	});
	it("valid cursor is forwarded to searchAll as `after`", async () => {
		const c = encodeSearchCursor({ q: "faith", scope: "scripture", tier: 3, score: 1.2, id: "x" });
		await loader(makeArgs(`?q=faith&scope=scripture&after=${c}`));
		expect((vi.mocked(searchAll).mock.calls[0][1] as any).after).toBeTruthy();
	});
});
