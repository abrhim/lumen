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

const GROUP_KEYS = ["scripture", "people", "places", "topics", "episodes", "art", "words"];
const EMPTY_RESPONSE = {
	query: "q",
	reference: null,
	groups: GROUP_KEYS.map((key) => ({ key, results: [] })),
	meta: { perGroup: {}, totalMs: 1 },
};

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
		["1-char q", "?q=a", "q_length"],
		["201-char q", `?q=${"x".repeat(201)}`, "q_length"],
		["unknown scope", "?q=faith&scope=nonsense", "scope_unknown"],
		["empty scope segment", "?q=faith&scope=scripture,,people", "scope_unknown"],
		["empty scope value", "?q=faith&scope=", "scope_unknown"],
		["non-numeric limit", "?q=faith&limit=abc", "limit_invalid"],
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

	it("scope CSV is split/trimmed/deduped before forwarding", async () => {
		await loader(makeArgs("?q=faith&scope=scripture,%20people,scripture"));
		expect(searchAll.mock.calls[0][1].scope).toEqual(["scripture", "people"]);
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
		expect(
			logEvent.mock.calls.some((c) => c[0] === "search_failed"),
			"search_failed must be logged server-side",
		).toBe(true);
	});

	it("successful search emits one search_executed log line (OBS-1)", async () => {
		await loader(makeArgs("?q=faith"));
		const call = logEvent.mock.calls.find((c) => c[0] === "search_executed");
		expect(call, "search_executed logged").toBeTruthy();
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
});

describe("wiring pins — route registration", () => {
	it("api/search is registered in routes.ts", () => {
		const here = dirname(fileURLToPath(import.meta.url));
		const routes = readFileSync(resolve(here, "../../routes.ts"), "utf8");
		expect(routes).toMatch(/api[/.]search/);
	});
});
