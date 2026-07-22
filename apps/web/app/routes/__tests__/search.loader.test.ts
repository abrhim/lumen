/**
 * search-ui harness — /search page loader (F6, F7, F8, F10, F12, F13, F14,
 * F17, F18, F19, F20, F21-render).
 * Written RED-FIRST: `../search` does not exist yet — this whole suite fails
 * at collection on the missing module, which is the intended red.
 * F9/F11 (modal hotkeys, selection-across-append) are e2e-smoke items — see
 * plan.md; they are asserted at step-8 verification, not unit-mocked here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GROUP_KEYS, type SearchResponse } from "@lumen/scripture";

vi.mock("@lumen/scripture", async (importOriginal) => {
	const real = await importOriginal<typeof import("@lumen/scripture")>();
	return { ...real, searchAll: vi.fn(), getPublicCollectionIds: vi.fn().mockResolvedValue(["phase-b"]) };
});
vi.mock("~/lib/auth.server", () => ({
	getSessionUser: vi.fn().mockResolvedValue({ user: null, headers: new Headers() }),
}));
vi.mock("~/lib/log.server", () => ({ logEvent: vi.fn() }));

import { searchAll } from "@lumen/scripture";
import { getSessionUser } from "~/lib/auth.server";
import { logEvent } from "~/lib/log.server";
// RED: module under test does not exist yet.
import { loader, adaptiveLimit, parseMarks } from "../search";

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

const REFERENCE_RESPONSE = () =>
	({
		...structuredClone(EMPTY),
		query: "1 nephi 3:7",
		reference: {
			level: "verse",
			book_id: "1-ne",
			chapter: 3,
			verse: 7,
			verse_id: "1-ne-3-7",
			display: "1 Nephi 3:7",
			found: true,
		},
		meta: { ...EMPTY.meta, mode: "none" },
	}) satisfies SearchResponse;

function makeArgs(qs: string) {
	const db = { execute: vi.fn().mockResolvedValue([]) };
	return {
		request: new Request(`https://lumen.test/search${qs}`),
		context: { db, cloudflare: { env: {} } },
		params: {},
	} as any;
}

beforeEach(() => {
	vi.mocked(searchAll).mockReset().mockResolvedValue(structuredClone(EMPTY));
	vi.mocked(logEvent).mockClear();
});

describe("F6 — SSR loader contract", () => {
	it("calls searchAll directly (no self-HTTP) and returns data for first paint", async () => {
		const data = await loader(makeArgs("?q=faith"));
		expect(searchAll).toHaveBeenCalledTimes(1);
		expect(data.results.groups.map((g: any) => g.key)).toEqual([...GROUP_KEYS]);
	});
	it("logs search_executed exactly once (no double-log with the API route)", async () => {
		await loader(makeArgs("?q=faith"));
		const calls = vi.mocked(logEvent).mock.calls.filter((c) => c[0] === "search_executed");
		expect(calls).toHaveLength(1);
	});
	it("bounded query count: visibility + search only (CPERF guard, anonymous)", async () => {
		const args = makeArgs("?q=faith");
		await loader(args);
		expect(args.context.db.execute.mock.calls.length).toBeLessThanOrEqual(1);
	});
});

describe("F7/F8 — scope + adaptive density", () => {
	it("scope from URL is forwarded canonicalized and adaptive limit applies", async () => {
		await loader(makeArgs("?q=faith&scope=words,scripture"));
		const opts = vi.mocked(searchAll).mock.calls[0][1] as any;
		expect(opts.scope).toEqual(["scripture", "words"]);
		expect(opts.limitPerGroup).toBe(18);
	});
	it("adaptiveLimit mapping is pinned: 7→8, 4→12, 2→18, 1→25", () => {
		expect(adaptiveLimit(7)).toBe(8);
		expect(adaptiveLimit(5)).toBe(8);
		expect(adaptiveLimit(4)).toBe(12);
		expect(adaptiveLimit(3)).toBe(12);
		expect(adaptiveLimit(2)).toBe(18);
		expect(adaptiveLimit(1)).toBe(25);
	});
	it("unknown scope key in URL → thrown 400 response, not a crash", async () => {
		await expect(loader(makeArgs("?q=faith&scope=bogus"))).rejects.toMatchObject({ status: 400 });
	});
});

describe("F17 — Cache-Control: private, no-store on EVERY exit branch (Δ SU-4)", () => {
	it("happy path", async () => {
		const data = await loader(makeArgs("?q=faith"));
		expect(data.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("designed empty state (no q)", async () => {
		const data = await loader(makeArgs(""));
		expect(data.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("keep-typing state (sub-Q_MIN q)", async () => {
		const data = await loader(makeArgs("?q=a"));
		expect(data.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("reference short-circuit", async () => {
		vi.mocked(searchAll).mockResolvedValueOnce(REFERENCE_RESPONSE());
		const data = await loader(makeArgs("?q=1%20nephi%203:7"));
		expect(data.headers.get("Cache-Control")).toBe("private, no-store");
	});
	it("thrown 400 (unknown scope): the REJECTED Response carries the header too", async () => {
		const err = await loader(makeArgs("?q=faith&scope=bogus")).then(
			() => {
				throw new Error("expected the loader to throw");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Response);
		expect((err as Response).status).toBe(400);
		expect((err as Response).headers.get("Cache-Control")).toBe("private, no-store");
	});
});

describe("F18 — CPERF guard on the ENTITLED session path (Δ PU-2/ACU-4)", () => {
	it("admin.collections: REAL getEntitlements + admin SELECT stay ≤ 2 queries; searchAll sees ALL collections", async () => {
		// Only the boundaries are mocked (session, searchAll, public ids) — the
		// entitlement derivation itself is the REAL getEntitlements, driven
		// through db.execute rows, so an extra query added to that path (the
		// CPERF-6 class) fails this count.
		vi.mocked(getSessionUser).mockResolvedValueOnce({
			user: { id: "u-admin", email: "admin@example.com" },
			headers: new Headers(),
		});
		const db = {
			execute: vi
				.fn()
				// 1st: getEntitlements' user_roles ⨝ roles query.
				.mockResolvedValueOnce([{ ent: "admin.collections" }])
				// 2nd: the loader's all-collections SELECT (entitled path).
				.mockResolvedValueOnce([
					{ id: "phase-b" },
					{ id: "unshaken" },
					{ id: "unshaken-private" },
				]),
		};
		const args = {
			request: new Request("https://lumen.test/search?q=faith"),
			context: { db, cloudflare: { env: {} } },
			params: {},
		} as any;
		await loader(args);
		expect(
			db.execute.mock.calls.length,
			"entitlements + admin collections SELECT only",
		).toBeLessThanOrEqual(2);
		const opts = vi.mocked(searchAll).mock.calls[0][1] as any;
		expect(opts.visibleCollections).toEqual(["phase-b", "unshaken", "unshaken-private"]);
	});
});

describe("F19 — designed empty + keep-typing states (Δ UU-2/UU-9)", () => {
	it("bare /search (no q) → data.state 'empty', results null, searchAll never called", async () => {
		const data = await loader(makeArgs(""));
		expect(searchAll).not.toHaveBeenCalled();
		expect(data.state).toBe("empty");
		expect(data.results).toBeNull();
	});
	it("sub-Q_MIN q ('a') → data.state 'keepTyping', searchAll never called", async () => {
		const data = await loader(makeArgs("?q=a"));
		expect(searchAll).not.toHaveBeenCalled();
		expect(data.state).toBe("keepTyping");
	});
});

describe("F12 — snippet mark parsing", () => {
	it("parses ⟪⟫ into typed segments, never leaks the marker glyphs", () => {
		const segs = parseMarks("whom ⟪sware⟫ he that");
		expect(segs).toEqual([
			{ mark: false, text: "whom " },
			{ mark: true, text: "sware" },
			{ mark: false, text: " he that" },
		]);
	});
	it("unbalanced markers degrade to plain text, no throw", () => {
		const segs = parseMarks("broken ⟪half");
		expect(segs.every((s) => !s.text.includes("⟪"))).toBe(true);
	});
});

describe("F21 — MarkedText emits JSX only (Δ SU-5)", () => {
	it("returns plain strings + <mark> elements; no dangerouslySetInnerHTML, no marker glyphs", async () => {
		// React ELEMENT introspection, not DOM: call the component as a function
		// and walk the returned tree.
		const { MarkedText } = await import("../search");
		const tree = MarkedText({ text: "a ⟪b⟫ c" });
		const rawKids = Array.isArray(tree) ? tree : tree.props.children;
		const kids = (Array.isArray(rawKids) ? rawKids : [rawKids])
			.flat(Number.POSITIVE_INFINITY)
			.filter((k: any) => k !== null && k !== undefined && k !== false && k !== "");
		expect(kids.length).toBeGreaterThanOrEqual(3);
		for (const k of kids) {
			const isText = typeof k === "string";
			const isMark = typeof k === "object" && (k as any).type === "mark";
			expect(isText || isMark, `child must be a string or <mark>: ${JSON.stringify(k)}`).toBe(
				true,
			);
		}
		const mark = kids.find((k: any) => typeof k === "object") as any;
		expect(mark?.props?.children).toBe("b");
		const serialized = JSON.stringify(tree);
		expect(serialized).not.toContain("dangerouslySetInnerHTML");
		expect(serialized).not.toContain("⟪");
		expect(serialized).not.toContain("⟫");
	});
});

describe("F13 — reference short-circuit", () => {
	it("resolved reference: loader flags referenceOnly, groups suppressed", async () => {
		vi.mocked(searchAll).mockResolvedValueOnce(REFERENCE_RESPONSE());
		const data = await loader(makeArgs("?q=1%20nephi%203:7"));
		expect(data.results.reference?.found).toBe(true);
		expect(data.referenceHref).toBe("/scripture/1-ne/3?verse=7");
		expect(data.state).toBe("reference");
	});

	// B-U2 (Abram, live test 2026-07-21): q='moses' — a BOOK-level bare-name
	// reference. Decision 4: book/volume level returns reference AND full FTS;
	// the page must render the groups with a reference lead, never suppress
	// them. Only verse/chapter levels short-circuit.
	it("book-level bare name: reference lead + FULL results, state 'results' (B-U2)", async () => {
		vi.mocked(searchAll).mockResolvedValueOnce({
			...structuredClone(EMPTY),
			query: "moses",
			reference: { level: "book", book_id: "moses", display: "moses", found: true },
			groups: GROUP_KEYS.map((key) => ({
				key,
				results:
					key === "people"
						? [{ type: "person", id: "moses-1", title: "Moses", tier: 1, score: 9, payload: {} }]
						: [],
			})),
		} satisfies SearchResponse);
		const data = await loader(makeArgs("?q=moses"));
		expect(data.state).toBe("results");
		expect(data.referenceHref).toBe("/scripture/moses");
		expect(
			data.results.groups.find((g: any) => g.key === "people")?.results,
		).toHaveLength(1);
	});
});

describe("F20 — pagination fetch URL + moment dedupe (Δ CU-7/CU-4)", () => {
	it("buildPageFetchUrl: single-scope fetch carries an EXPLICIT limit from adaptive density plus the cursor", async () => {
		const { buildPageFetchUrl } = await import("../search");
		const url = buildPageFetchUrl({ q: "faith", scope: ["scripture"], after: "OPAQUE123" });
		const u = new URL(url, "https://lumen.test");
		expect(u.pathname).toBe("/api/search");
		expect(u.searchParams.get("q")).toBe("faith");
		expect(u.searchParams.get("scope")).toBe("scripture");
		// Δ CU-7: 1 included group → 25; relying on the API's default-8 here
		// would silently shrink continuation pages.
		expect(u.searchParams.get("limit")).toBe("25");
		expect(u.searchParams.get("after")).toBe("OPAQUE123");
	});
	it("dedupeMoments: an appended page colliding on (episode_id, t_start_s) drops the duplicate", async () => {
		const { dedupeMoments } = await import("../search");
		const moment = (id: string, episode_id: string, t_start_s: number) => ({
			type: "moment",
			id,
			title: "t",
			tier: 3,
			score: 1,
			payload: { episode_id, t_start_s },
		});
		const page1 = [
			moment("m-a", "unshaken-25hrVBU3Vz8", 371),
			moment("m-b", "unshaken-25hrVBU3Vz8", 512),
		];
		// Δ CU-4: M3 re-windows re-key moment ids — the SAME payload tuple can
		// arrive under a brand-new id on the next page. Identity is the tuple.
		const page2 = [
			moment("m-zzz", "unshaken-25hrVBU3Vz8", 371),
			moment("m-c", "unshaken-25hrVBU3Vz8", 640),
		];
		const merged = dedupeMoments(page1, page2);
		expect(merged.map((m: any) => [m.payload.episode_id, m.payload.t_start_s])).toEqual([
			["unshaken-25hrVBU3Vz8", 371],
			["unshaken-25hrVBU3Vz8", 512],
			["unshaken-25hrVBU3Vz8", 640],
		]);
	});
});

describe("F10/F14 — deep links + route registration", () => {
	it("moment href builder uses payload, never result.id (A6: ids are response-scoped)", async () => {
		const { momentHref } = await import("../search");
		expect(
			momentHref({ episode_id: "unshaken-25hrVBU3Vz8", t_start_s: 371 } as any),
		).toBe("/media/unshaken-25hrVBU3Vz8?t=371");
	});
	it("search route is registered above the :type/:id catch-all", async () => {
		const { default: routes } = await import("../../routes");
		const flat = JSON.stringify(routes);
		const searchIdx = flat.indexOf("routes/search.tsx");
		const catchAllIdx = flat.indexOf("routes/node.tsx");
		expect(searchIdx).toBeGreaterThan(-1);
		expect(searchIdx).toBeLessThan(catchAllIdx);
	});
});
