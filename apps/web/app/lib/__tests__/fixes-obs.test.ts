/**
 * Step-13 fix-pass repros — observability + search-surface contracts
 * (worker C): B14 (CP-15), B42 (CP-45), B44 (CP-47/API-CONTRACT-8),
 * B53 (CP-70 loader echo).
 *
 * Written red-first against the pre-fix code:
 *  - B14: notes-only searches logged `zeroResult: true, scope: null` —
 *    canon-engine pollution in the direction A4's pin didn't cover.
 *  - B42: `extraGroups.notes.hits` claimed hits on the reference
 *    short-circuit path where the group was dropped from the response.
 *  - B44: search.tsx's early deferred-scope session read sat outside the
 *    try that owns the loader's 500 contract — a session throw was a
 *    framework error page with no `search_failed` log and no headers.
 *  - B53: the loader gave the client no way to know a notes-only search
 *    ran, so the page rendered an all-canon ghost state.
 *
 * Signed-out byte-freeze (the deferred scope ruling) is pinned as a
 * non-regression alongside each fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchResponse } from "@lumen/scripture";

const { getSessionUser, searchAll, getPublicCollectionIds, logEvent, searchNotesLeg } = vi.hoisted(
	() => ({
		getSessionUser: vi.fn(),
		searchAll: vi.fn(),
		getPublicCollectionIds: vi.fn(),
		logEvent: vi.fn(),
		searchNotesLeg: vi.fn(),
	}),
);

vi.mock("~/lib/auth.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/auth.server")>();
	return { ...actual, getSessionUser };
});

vi.mock("~/lib/log.server", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, logEvent };
});

vi.mock("@lumen/scripture", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, searchAll, getPublicCollectionIds };
});

// mergeNotesGroup stays REAL (the merge semantics are pinned elsewhere);
// only the leg's I/O is stubbed.
vi.mock("~/lib/notes.server", async (importOriginal) => {
	const actual = await importOriginal<Record<string, unknown>>();
	return { ...actual, searchNotesLeg };
});

import { logSearchExecuted } from "~/lib/search-obs.server";
import { loader as apiLoader } from "../../routes/api.search";
import { loader as pageLoader } from "../../routes/search";

const GROUP_KEYS = ["scripture", "people", "places", "topics", "episodes", "art", "words"] as const;

const EMPTY_RESPONSE = {
	query: "faith",
	reference: null,
	groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
	meta: { perGroup: {}, totalMs: 1, mode: "combined" },
} satisfies SearchResponse;

/** The synthetic response both routes build for a notes-only scope — the
 * canon engine never ran (CF-7). */
const NONE_RESPONSE = {
	query: "faith",
	reference: null,
	groups: [],
	meta: { perGroup: {}, totalMs: 0, mode: "none" },
} satisfies SearchResponse;

const VERSE_REFERENCE_RESPONSE = {
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
	groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
	meta: { perGroup: {}, totalMs: 2, mode: "none" },
} satisfies SearchResponse;

const noteResult = (i: number) => ({
	type: "note",
	id: `00000000-0000-4000-8000-00000000000${i}`,
	title: `Note ${i}`,
	snippet: "a ⟪match⟫",
	tier: 1,
	score: 1,
	payload: {},
});

const notesGroup = (hits: number, degraded = false) => ({
	key: "notes",
	results: Array.from({ length: hits }, (_, i) => noteResult(i)),
	...(degraded ? { degraded: true } : {}),
});

const SIGNED_IN = { user: { id: "u-1", email: "u@example.com" }, headers: new Headers() };
const SIGNED_OUT = { user: null, headers: new Headers() };

function makeDb() {
	return { execute: vi.fn(async () => []) };
}

function apiArgs(search: string, db = makeDb()) {
	return {
		params: {},
		request: new Request(`https://lumen.test/api/search${search}`),
		context: { db, cloudflare: { env: {}, ctx: {} } },
	} as never;
}

function pageArgs(search: string, db = makeDb()) {
	return {
		params: {},
		request: new Request(`https://lumen.test/search${search}`),
		context: { db, cloudflare: { env: {}, ctx: {} } },
	} as never;
}

/** search.tsx returns data(payload, {headers}) — unwrap like its own suite. */
const pagePayload = (res: unknown) =>
	(res as { data: Record<string, unknown> }).data as {
		state: string;
		scope: unknown;
		notesOnly: boolean;
		results: { groups: Array<{ key: string }> } | null;
	};

const executedEvent = () =>
	logEvent.mock.calls.find((c) => c[0] === "search_executed")?.[1] as
		| Record<string, unknown>
		| undefined;

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue(SIGNED_OUT);
	getPublicCollectionIds.mockResolvedValue(["canon"]);
	searchAll.mockResolvedValue(structuredClone(EMPTY_RESPONSE));
	searchNotesLeg.mockResolvedValue(notesGroup(2));
});

/* ─── B14 — zeroResult purity + the notes-only marker (CP-15) ─── */

describe("B14 — logSearchExecuted never counts a search the engine didn't run", () => {
	it("mode 'none' (synthetic notes-only response) → zeroResult false, notesOnly marked", () => {
		logSearchExecuted(NONE_RESPONSE, {
			q: "faith",
			scope: undefined,
			visibility: "public",
			surface: "api",
			notesOnly: true,
		});
		const ev = executedEvent();
		expect(ev).toBeTruthy();
		expect(ev).toMatchObject({ zeroResult: false, notesOnly: true, mode: "none" });
	});

	it("regression: a REAL zero-hit combined search still logs zeroResult true, no notesOnly field", () => {
		logSearchExecuted(structuredClone(EMPTY_RESPONSE), {
			q: "faith",
			scope: undefined,
			visibility: "public",
			surface: "api",
		});
		const ev = executedEvent();
		expect(ev).toMatchObject({ zeroResult: true, mode: "combined" });
		expect(ev).not.toHaveProperty("notesOnly");
	});
});

describe("B14 — signed-in scope=notes routes log honestly", () => {
	it("/api/search: canon engine skipped, event carries notesOnly + zeroResult false", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = (await apiLoader(apiArgs("?q=faith&scope=notes"))) as Response;
		expect(res.status).toBe(200);
		expect(searchAll).not.toHaveBeenCalled();
		const body = (await res.json()) as { groups: Array<{ key: string }> };
		expect(body.groups.map((g) => g.key)).toEqual(["notes"]);
		const ev = executedEvent();
		expect(ev).toMatchObject({ zeroResult: false, notesOnly: true, mode: "none" });
		expect(ev?.extraGroups).toEqual({ notes: { hits: 2, degraded: false } });
	});

	it("/search page loader: same event contract on the SSR surface", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		await pageLoader(pageArgs("?q=faith&scope=notes"));
		expect(searchAll).not.toHaveBeenCalled();
		const ev = executedEvent();
		expect(ev).toMatchObject({
			surface: "page",
			zeroResult: false,
			notesOnly: true,
			mode: "none",
		});
	});

	it("byte-freeze non-regression: signed-out scope=notes is the frozen 400, nothing logged", async () => {
		const res = (await apiLoader(apiArgs("?q=faith&scope=notes"))) as Response;
		expect(res.status).toBe(400);
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe("scope_unknown");
		expect(searchNotesLeg).not.toHaveBeenCalled();
		expect(executedEvent()).toBeUndefined();
	});
});

/* ─── B42 — extraGroups matches the response on the short-circuit path (CP-45) ─── */

describe("B42 — reference short-circuit never logs notes hits the user never received", () => {
	it("/api/search: dropped group logs {hits: 0, degraded, skipped: true}", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		searchAll.mockResolvedValue(structuredClone(VERSE_REFERENCE_RESPONSE));
		const res = (await apiLoader(apiArgs("?q=1%20nephi%203:7"))) as Response;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { groups: Array<{ key: string }> };
		// the response correctly drops the notes group per A4 —
		expect(body.groups.some((g) => g.key === "notes")).toBe(false);
		// — and the log now matches it.
		const ev = executedEvent();
		expect(ev?.extraGroups).toEqual({ notes: { hits: 0, degraded: false, skipped: true } });
	});

	it("/search page loader: same skipped marker on the SSR surface", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		searchAll.mockResolvedValue(structuredClone(VERSE_REFERENCE_RESPONSE));
		const res = await pageLoader(pageArgs("?q=1%20nephi%203:7"));
		expect(pagePayload(res).results?.groups.some((g) => g.key === "notes")).toBe(false);
		const ev = executedEvent();
		expect(ev?.extraGroups).toEqual({ notes: { hits: 0, degraded: false, skipped: true } });
	});

	it("non-short-circuit: hits logged verbatim, no skipped marker; zeroResult stays a pure canon signal", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = (await apiLoader(apiArgs("?q=faith"))) as Response;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { groups: Array<{ key: string }> };
		expect(body.groups[0]?.key).toBe("notes");
		const ev = executedEvent();
		expect(ev?.extraGroups).toEqual({ notes: { hits: 2, degraded: false } });
		// A4: notes hits ride extraGroups only — the canon engine ran and found
		// nothing, so zeroResult remains an honest relevance signal.
		expect(ev).toMatchObject({ zeroResult: true });
		expect(ev).not.toHaveProperty("notesOnly");
	});
});

/* ─── B44 — the early deferred-scope session read owns its 500 contract (CP-47) ─── */

describe("B44 — /search q-invalid deferred-scope branch: session throws exit through the loader's contract", () => {
	it("session-pool throw → thrown 500 Response with no-store headers + search_failed, never a framework error", async () => {
		getSessionUser.mockRejectedValueOnce(new Error("remaining connection slots are reserved"));
		const err = await pageLoader(pageArgs("?scope=notes")).then(
			() => {
				throw new Error("expected the loader to throw");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Response);
		expect((err as Response).status).toBe(500);
		expect((err as Response).headers.get("Cache-Control")).toBe("private, no-store");
		const failed = logEvent.mock.calls.find((c) => c[0] === "search_failed");
		expect(failed, "search_failed must be logged").toBeTruthy();
		expect(failed?.[1]).toMatchObject({ surface: "page", visibility: "public" });
	});

	it("byte-freeze non-regression: signed-out ?scope=notes (no q) stays the deliberate 400 with no-store", async () => {
		const err = await pageLoader(pageArgs("?scope=notes")).then(
			() => {
				throw new Error("expected the loader to throw");
			},
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(Response);
		expect((err as Response).status).toBe(400);
		expect((err as Response).headers.get("Cache-Control")).toBe("private, no-store");
		expect(logEvent.mock.calls.some((c) => c[0] === "search_failed")).toBe(false);
	});

	it("signed-in ?scope=notes (no q) falls through to the designed empty state, notesOnly echoed", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = await pageLoader(pageArgs("?scope=notes"));
		const p = pagePayload(res);
		expect(p.state).toBe("empty");
		expect(p.notesOnly).toBe(true);
	});
});

/* ─── B53 — loader echoes the notes-only scope (CP-70) ─── */

describe("B53 — /search?scope=notes loaderData reflects the search that actually ran", () => {
	it("signed-in notes-only: notesOnly true, scope null, notes group in the payload", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = await pageLoader(pageArgs("?q=faith&scope=notes"));
		const p = pagePayload(res);
		expect(p.state).toBe("results");
		expect(p.notesOnly).toBe(true);
		expect(p.scope).toBeNull();
		expect(p.results?.groups.map((g) => g.key)).toEqual(["notes"]);
	});

	it("mixed scope (scripture,notes): notesOnly false, canon scope preserved", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = await pageLoader(pageArgs("?q=faith&scope=scripture,notes"));
		const p = pagePayload(res);
		expect(p.notesOnly).toBe(false);
		expect(p.scope).toEqual(["scripture"]);
	});

	it("plain unscoped search: notesOnly false (no behavior change)", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		const res = await pageLoader(pageArgs("?q=faith"));
		expect(pagePayload(res).notesOnly).toBe(false);
	});
});

/* ─── B32 (CP-34) — data precondition for the degraded zero view ─── */

describe("B32 — a degraded notes leg survives to the payload when canon is empty", () => {
	it("empty canon + degraded leg: the notes group (degraded: true) reaches the client", async () => {
		getSessionUser.mockResolvedValue(SIGNED_IN);
		searchNotesLeg.mockResolvedValue(notesGroup(0, true));
		const res = await pageLoader(pageArgs("?q=faith"));
		const groups = pagePayload(res).results?.groups ?? [];
		const notes = groups.find((g) => g.key === "notes") as
			| { key: string; degraded?: boolean; results: unknown[] }
			| undefined;
		expect(notes, "degraded group must be present — absence reads as 'no matching notes'").toBeTruthy();
		expect(notes?.degraded).toBe(true);
		expect(notes?.results).toHaveLength(0);
	});
});
