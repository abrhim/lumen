import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Endpoint harness (search-endpoint H14 + H18 + H9-http + wiring pins; amended
// at step 6 synthesis per API-3/7/8/9, OBS-3, SEC-4 — see plan.md ## Decisions).
// Mocks the auth boundary + searchAll + logEvent, runs the REAL loader, and
// pins INTEGRATION points: visibility derivation, validation, headers, logging.
// searchAll's behavior (H1–H13, H15–H17) is covered live in
// packages/scripture/src/__tests__/search-harness.test.ts.

const { getSessionUser, searchAll, getPublicCollectionIds, logEvent } = vi.hoisted(() => ({
	getSessionUser: vi.fn(),
	searchAll: vi.fn(),
	getPublicCollectionIds: vi.fn(),
	logEvent: vi.fn(),
}));

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

import { loader } from "../api.search";
import type { SearchResponse } from "@lumen/scripture";

const GROUP_KEYS = ["scripture", "people", "places", "topics", "episodes", "art", "words"] as const;
// `satisfies` pins the mock to the real contract — drift (e.g. a missing
// meta.mode, which the loader logs) fails typecheck instead of silently
// logging undefined.
const EMPTY_RESPONSE = {
	query: "q",
	reference: null,
	groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
	meta: { perGroup: {}, totalMs: 1, mode: "combined" },
} satisfies SearchResponse;

function makeDb() {
	return { execute: vi.fn(async () => []) };
}

function makeArgs(search: string, db = makeDb()) {
	return {
		params: {},
		request: new Request(`https://x/api/search${search}`),
		context: { db, cloudflare: { env: {}, ctx: {} } },
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue({ user: null, headers: new Headers() });
	getPublicCollectionIds.mockResolvedValue(["canon", "jst", "naves", "strongs", "art"]);
	searchAll.mockResolvedValue(EMPTY_RESPONSE);
});

describe("H14 — input validation (400 JSON with stable codes; searchAll never reached)", () => {
	const badQueries = [
		["missing q", "", "q_required"],
		["whitespace-only q", "?q=%20%20", "q_required"],
		["1-char q", "?q=a", "q_length"],
		["201-char q", `?q=${"x".repeat(201)}`, "q_length"],
		["unknown scope", "?q=faith&scope=nonsense", "scope_unknown"],
		["empty scope segment", "?q=faith&scope=scripture,,people", "scope_unknown"],
		["empty scope value", "?q=faith&scope=", "scope_unknown"],
		["non-numeric limit", "?q=faith&limit=abc", "limit_invalid"],
		["empty limit", "?q=faith&limit=", "limit_invalid"],
		["whitespace limit", "?q=faith&limit=%20", "limit_invalid"],
	] as const;

	for (const [label, qs, code] of badQueries) {
		it(`${label} → 400 {error, code:${code}}`, async () => {
			const res = (await loader(makeArgs(qs))) as Response;
			expect(res.status).toBe(400);
			expect(res.headers.get("content-type")).toContain("application/json");
			const body = (await res.json()) as { error?: string; code?: string };
			expect(body.error).toBeTruthy();
			expect(body.code).toBe(code);
			expect(searchAll).not.toHaveBeenCalled();
		});
	}

	it("out-of-range limit clamps to [1,25], default 8 (documented asymmetry with limit=abc)", async () => {
		await loader(makeArgs("?q=faith&limit=999"));
		expect(searchAll.mock.calls[0][1].limitPerGroup).toBe(25);
		await loader(makeArgs("?q=faith&limit=0"));
		expect(searchAll.mock.calls[1][1].limitPerGroup).toBe(1);
		await loader(makeArgs("?q=faith"));
		expect(searchAll.mock.calls[2][1].limitPerGroup).toBe(8);
	});

	it("fractional limit floors then clamps; hex is numeric — only non-numeric 400s (decision 5)", async () => {
		await loader(makeArgs("?q=faith&limit=2.5"));
		expect(searchAll.mock.calls[0][1].limitPerGroup).toBe(2);
		await loader(makeArgs("?q=faith&limit=0x10"));
		expect(searchAll.mock.calls[1][1].limitPerGroup).toBe(16);
	});

	it("scope CSV is split/trimmed/deduped before forwarding", async () => {
		await loader(makeArgs("?q=faith&scope=scripture,%20people,scripture"));
		expect(searchAll.mock.calls[0][1].scope).toEqual(["scripture", "people"]);
	});

	it("scope CSV canonicalizes to GROUP_KEYS order regardless of request order", async () => {
		await loader(makeArgs("?q=faith&scope=words,scripture"));
		expect(searchAll.mock.calls[0][1].scope).toEqual(["scripture", "words"]);
	});

	it("zero-hit query → 200 with ALL scoped keys present, results empty, fixed order (API-8)", async () => {
		const res = (await loader(makeArgs("?q=zzzqqqxyz"))) as Response;
		expect(res.status).toBe(200);
		const body = (await res.json()) as { groups: Array<{ key: string; results: unknown[] }> };
		expect(body.groups.map((g) => g.key)).toEqual(GROUP_KEYS);
		expect(body.groups.every((g) => g.results.length === 0)).toBe(true);
	});
});

describe("H18 — headers and failure contract", () => {
	it("Cache-Control: private, no-store on 200", async () => {
		const res = (await loader(makeArgs("?q=faith"))) as Response;
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
	});

	it("Cache-Control: private, no-store on 400", async () => {
		const res = (await loader(makeArgs("?q=a"))) as Response;
		expect(res.status).toBe(400);
		expect(res.headers.get("cache-control")).toBe("private, no-store");
	});

	it("searchAll rejection → 500 JSON {error, code:'internal'}, internals scrubbed, logged (OBS-3)", async () => {
		searchAll.mockRejectedValueOnce(new Error("connection closed mid-response"));
		const res = (await loader(makeArgs("?q=faith"))) as Response;
		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const body = (await res.json()) as { error?: string; code?: string };
		expect(body.error).toBeTruthy();
		expect(body.code).toBe("internal");
		expect(body.error).not.toContain("connection closed");
		const failed = logEvent.mock.calls.find((c) => c[0] === "search_failed");
		expect(failed, "search_failed must be logged server-side").toBeTruthy();
		// OBS-3: a 500 must be reproducible — the failing q/scope/visibility ride along.
		expect(failed?.[1]).toMatchObject({ q: "faith", scope: null, visibility: "public" });
	});

	it("visibility-phase failure (getPublicCollectionIds rejects) → same JSON 500 contract, rotation headers kept", async () => {
		getSessionUser.mockResolvedValueOnce({
			user: null,
			headers: new Headers({ "Set-Cookie": "lumen_session=rotated; Path=/; HttpOnly" }),
		});
		getPublicCollectionIds.mockRejectedValueOnce(
			new Error("remaining connection slots are reserved"),
		);
		const res = (await loader(makeArgs("?q=faith"))) as Response;
		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const body = (await res.json()) as { error?: string; code?: string };
		expect(body.code).toBe("internal");
		expect(body.error).not.toContain("connection slots");
		expect(res.headers.get("set-cookie")).toContain("lumen_session=rotated");
		expect(logEvent.mock.calls.some((c) => c[0] === "search_failed")).toBe(true);
	});

	it("session-phase failure (getSessionUser rejects) → still the JSON 500 contract", async () => {
		getSessionUser.mockRejectedValueOnce(new Error("kv timeout"));
		const res = (await loader(makeArgs("?q=faith"))) as Response;
		expect(res.status).toBe(500);
		expect(res.headers.get("content-type")).toContain("application/json");
		expect(res.headers.get("cache-control")).toBe("private, no-store");
		const body = (await res.json()) as { code?: string };
		expect(body.code).toBe("internal");
		expect(logEvent.mock.calls.some((c) => c[0] === "search_failed")).toBe(true);
	});

	it("successful search emits search_executed with the OBS-1 field set (mode pinned — mock drift)", async () => {
		await loader(makeArgs("?q=faith"));
		const call = logEvent.mock.calls.find((c) => c[0] === "search_executed");
		expect(call, "search_executed logged").toBeTruthy();
		expect(call?.[1]).toMatchObject({
			q: "faith",
			scope: null,
			mode: "combined",
			visibility: "public",
			zeroResult: true,
			perGroupMs: {},
		});
	});
});

describe("OBS-2 wiring — degraded groups", () => {
	const degradedResponse = () =>
		({
			query: "faith",
			reference: null,
			groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
			meta: {
				perGroup: {
					scripture: { ms: 12, hits: 0 },
					people: { ms: 7, hits: 0, error: "relation vanished" },
				},
				totalMs: 40,
				mode: "fallback",
				combinedError: "canceling statement due to statement timeout",
			},
		}) satisfies SearchResponse;

	it("perGroup.error → search_group_degraded with the documented {key, message, ms} payload", async () => {
		searchAll.mockResolvedValueOnce(degradedResponse());
		const res = (await loader(makeArgs("?q=faith"))) as Response;
		expect(res.status).toBe(200);
		const call = logEvent.mock.calls.find((c) => c[0] === "search_group_degraded");
		expect(call, "search_group_degraded logged").toBeTruthy();
		expect(call?.[1]).toEqual({ key: "people", message: "relation vanished", ms: 7 });
	});

	it("a degraded request is never zeroResult, even with zero hits everywhere (OBS-2)", async () => {
		searchAll.mockResolvedValueOnce(degradedResponse());
		await loader(makeArgs("?q=faith"));
		const call = logEvent.mock.calls.find((c) => c[0] === "search_executed");
		expect(call?.[1]).toMatchObject({ mode: "fallback", zeroResult: false });
	});

	it("meta.combinedError reaches search_executed — the combined-failure cause is recorded (B15)", async () => {
		searchAll.mockResolvedValueOnce(degradedResponse());
		await loader(makeArgs("?q=faith"));
		const call = logEvent.mock.calls.find((c) => c[0] === "search_executed");
		expect(call?.[1]).toMatchObject({
			combinedError: "canceling statement due to statement timeout",
		});
	});
});

describe("H9-http — hostile inputs never escape the JSON contract", () => {
	const hostiles = [
		`'; DROP TABLE lumen.verses; --`,
		`faith & hope | !charity`,
		`%_\\%`,
		`__proto__`,
		`אב שלום`,
	];

	for (const q of hostiles) {
		it(`q=${q.slice(0, 24)} → JSON 200/400, never a throw`, async () => {
			const res = (await loader(makeArgs(`?q=${encodeURIComponent(q)}`))) as Response;
			expect([200, 400]).toContain(res.status);
			expect(res.headers.get("content-type")).toContain("application/json");
		});
	}
});

describe("wiring pins — visibility derivation is the loader's job", () => {
	it("anonymous: visibleCollections = getPublicCollectionIds(db) result, verbatim", async () => {
		await loader(makeArgs("?q=faith"));
		expect(getPublicCollectionIds).toHaveBeenCalledTimes(1);
		expect(searchAll).toHaveBeenCalledTimes(1);
		expect(searchAll.mock.calls[0][1].visibleCollections).toEqual([
			"canon",
			"jst",
			"naves",
			"strongs",
			"art",
		]);
	});

	it("signed-in WITHOUT the admin entitlement: still only public collections", async () => {
		getSessionUser.mockResolvedValue({
			user: { id: "u-1", email: "someone@example.com" },
			headers: new Headers(),
		});
		const db = makeDb(); // db.execute → [] → no entitlements
		await loader(makeArgs("?q=faith", db));
		expect(searchAll.mock.calls[0][1].visibleCollections).toEqual([
			"canon",
			"jst",
			"naves",
			"strongs",
			"art",
		]);
	});

	it("ADMIN_COLLECTIONS entitlement: ALL collections searched; search_executed logs visibility:'admin' + userId", async () => {
		getSessionUser.mockResolvedValue({
			user: { id: "u-admin", email: "admin@example.com" },
			headers: new Headers(),
		});
		const db = {
			execute: vi
				.fn()
				// 1st call: getEntitlements' roles query; 2nd: the loader's collections query.
				.mockResolvedValueOnce([{ ent: "admin.collections" }])
				.mockResolvedValueOnce([
					{ id: "canon" },
					{ id: "jst" },
					{ id: "naves" },
					{ id: "strongs" },
					{ id: "art" },
					{ id: "unshaken-private" },
				]),
		} as never;
		const res = (await loader(makeArgs("?q=faith", db))) as Response;
		expect(res.status).toBe(200);
		expect(searchAll.mock.calls[0][1].visibleCollections).toEqual([
			"canon",
			"jst",
			"naves",
			"strongs",
			"art",
			"unshaken-private",
		]);
		const call = logEvent.mock.calls.find((c) => c[0] === "search_executed");
		expect(call?.[1]).toMatchObject({ visibility: "admin", userId: "u-admin" });
	});
});

describe("wiring pins — route registration", () => {
	it("api/search is registered in routes.ts", () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const routes = readFileSync(resolve(here, "../../routes.ts"), "utf8");
		expect(routes).toMatch(/api[/.]search/);
	});
});
