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
import { loader, adaptiveLimit, parseMarks, wordParts, isApiPage } from "../search";

/** The loader returns `data(payload, { headers })` (B4 — session Set-Cookie must
 * ride the response), so a direct call yields the DataWithResponseInit wrapper:
 * payload on `.data`, response headers on `.init.headers`. */
const payload = (res: any) => res.data;
const resHeaders = (res: any) => new Headers(res.init?.headers);

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
		const res = await loader(makeArgs("?q=faith"));
		expect(searchAll).toHaveBeenCalledTimes(1);
		expect(payload(res).results.groups.map((g: any) => g.key)).toEqual([...GROUP_KEYS]);
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
		const res = await loader(makeArgs("?q=faith"));
		expect(resHeaders(res).get("Cache-Control")).toBe("private, no-store");
	});
	it("designed empty state (no q)", async () => {
		const res = await loader(makeArgs(""));
		expect(resHeaders(res).get("Cache-Control")).toBe("private, no-store");
	});
	it("keep-typing state (sub-Q_MIN q)", async () => {
		const res = await loader(makeArgs("?q=a"));
		expect(resHeaders(res).get("Cache-Control")).toBe("private, no-store");
	});
	it("reference short-circuit", async () => {
		vi.mocked(searchAll).mockResolvedValueOnce(REFERENCE_RESPONSE());
		const res = await loader(makeArgs("?q=1%20nephi%203:7"));
		expect(resHeaders(res).get("Cache-Control")).toBe("private, no-store");
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

describe("B4 — session token-rotation Set-Cookie survives client-nav (SC-1)", () => {
	it("happy path: session Set-Cookie rides the data() response, Cache-Control intact", async () => {
		vi.mocked(getSessionUser).mockResolvedValueOnce({
			user: null,
			headers: new Headers({ "Set-Cookie": "sb-session=rotated; Path=/; HttpOnly" }),
		});
		const res = await loader(makeArgs("?q=faith"));
		expect(resHeaders(res).get("Set-Cookie")).toContain("sb-session=rotated");
		expect(resHeaders(res).get("Cache-Control")).toBe("private, no-store");
	});
	it("500 path: the thrown Response keeps Cache-Control AND the session Set-Cookie", async () => {
		vi.mocked(getSessionUser).mockResolvedValueOnce({
			user: null,
			headers: new Headers({ "Set-Cookie": "sb-session=rot; Path=/" }),
		});
		vi.mocked(searchAll).mockRejectedValueOnce(new Error("pool exhausted"));
		const err = await loader(makeArgs("?q=faith")).then(
			() => {
				throw new Error("expected the loader to throw");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Response);
		expect((err as Response).status).toBe(500);
		expect((err as Response).headers.get("Cache-Control")).toBe("private, no-store");
		expect((err as Response).headers.get("Set-Cookie")).toContain("sb-session=rot");
	});
});

describe("B10 — hydration payload strips results.meta (raw DB error strings) (SC-2)", () => {
	it("returns only {query, reference, groups}, never meta", async () => {
		const res = await loader(makeArgs("?q=faith"));
		expect(payload(res).results).not.toHaveProperty("meta");
		expect(Object.keys(payload(res).results).sort()).toEqual(["groups", "query", "reference"]);
	});
});

describe("B16 — search_executed carries a surface discriminator (OC-2)", () => {
	it("the page loader logs surface: 'page'", async () => {
		await loader(makeArgs("?q=faith"));
		const call = vi.mocked(logEvent).mock.calls.find((c) => c[0] === "search_executed");
		expect(call?.[1]).toMatchObject({ surface: "page" });
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
		const res = await loader(makeArgs(""));
		expect(searchAll).not.toHaveBeenCalled();
		expect(payload(res).state).toBe("empty");
		expect(payload(res).results).toBeNull();
	});
	it("sub-Q_MIN q ('a') → data.state 'keepTyping', searchAll never called", async () => {
		const res = await loader(makeArgs("?q=a"));
		expect(searchAll).not.toHaveBeenCalled();
		expect(payload(res).state).toBe("keepTyping");
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
		const res = await loader(makeArgs("?q=1%20nephi%203:7"));
		expect(payload(res).results.reference?.found).toBe(true);
		expect(payload(res).referenceHref).toBe("/scripture/1-ne/3?verse=7");
		expect(payload(res).state).toBe("reference");
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
		const res = await loader(makeArgs("?q=moses"));
		expect(payload(res).state).toBe("results");
		expect(payload(res).referenceHref).toBe("/scripture/moses");
		expect(
			payload(res).results.groups.find((g: any) => g.key === "people")?.results,
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

describe("B3/B7 — fetcher shape-guard: API error bodies never reach `.groups` (CC-4/OC-1)", () => {
	it("returned {error,code} 400/500 body is NOT an ApiSearchPage (no crash / no false append)", () => {
		expect(isApiPage({ error: "cursor was minted for a different q", code: "cursor_mismatch" })).toBe(
			false,
		);
		expect(isApiPage({ error: "Search failed", code: "internal" })).toBe(false);
		expect(isApiPage(undefined)).toBe(false);
		expect(isApiPage(null)).toBe(false);
	});
	it("a real page body ({query, reference, groups}) passes the guard", () => {
		expect(isApiPage({ query: "faith", reference: null, groups: [] })).toBe(true);
	});
});

describe("B11 — words original-script parts come from the payload, not a title split", () => {
	const strong = (payload: Record<string, unknown>) =>
		({ type: "strongs", id: "x", title: "ou mē οὐ μή", tier: 1, score: 1, payload }) as any;

	it("multi-word original stays whole; name is the translit; lang/dir from payload", () => {
		// The last-space split rendered name "ou mē οὐ" / original "μή" — the 354-row
		// mode. The payload carries them cleanly.
		const p = wordParts(
			strong({ strongs_no: "G20852", translit: "ou mē", original: "οὐ μή", lang: "grc", dir: "ltr" }),
		);
		expect(p.name).toBe("ou mē");
		expect(p.original).toBe("οὐ μή");
		expect(p.lang).toBe("grc");
		expect(p.dir).toBe("ltr");
	});

	it("hebrew: rtl + he ride the original-script span", () => {
		const p = wordParts(
			strong({ strongs_no: "H1285", translit: "be.rit", original: "בְּרִית", lang: "he", dir: "rtl" }),
		);
		expect(p).toMatchObject({ name: "be.rit", original: "בְּרִית", lang: "he", dir: "rtl" });
	});

	it("payload without translit/original → falls back to title, renders no original span", () => {
		const p = wordParts(strong({ strongs_no: "H1" }));
		expect(p.name).toBe("ou mē οὐ μή");
		expect(p.original).toBe("");
		expect(p.dir).toBeUndefined();
	});
});
