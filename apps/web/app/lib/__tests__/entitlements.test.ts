import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logEvent } from "../log.server";
import {
	getEntitlements,
	requireEntitlement,
	ADMIN_USERS,
	type Entitlement,
} from "../entitlements.server";

vi.mock("../log.server", () => ({ logEvent: vi.fn() }));

// H1's distinct-key union needs more than one KNOWN key; prod ships exactly one
// ("admin.users") today. Extend the const list with test-only keys, preserving
// the predicate's exact semantics (`includes` over the list) — the real
// ADMIN_USERS rides through untouched so the happy path still exercises the
// production key.
vi.mock("../entitlements-keys", async (importOriginal) => {
	const real = await importOriginal<typeof import("../entitlements-keys")>();
	const ENTITLEMENTS = [...real.ENTITLEMENTS, "test.alpha", "test.beta"] as const;
	return {
		...real,
		ENTITLEMENTS,
		isKnownEntitlement: (key: string) => (ENTITLEMENTS as readonly string[]).includes(key),
	};
});

const TEST_ALPHA = "test.alpha" as Entitlement;
const TEST_BETA = "test.beta" as Entitlement;

/** postgres.js resolves a RowList — an array CARRYING result metadata (count,
 * command, …), not a bare array. The fake keeps that shape so the loader's
 * `as unknown as { ent: string }[]` cast stays honest against the driver. */
function makeRowList<T extends object>(rows: T[]): T[] {
	return Object.assign([...rows], { count: rows.length, command: "SELECT" as const });
}

/** Fake drizzle/postgres-js db whose single `execute` we script per test. */
function fakeDb() {
	const execute = vi.fn();
	return { execute, db: { execute } as unknown as PostgresJsDatabase };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("H1 role→entitlement flattening (getEntitlements)", () => {
	it("unions multiple rows into one set — every known key granted by any role lands", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(
			makeRowList([{ ent: ADMIN_USERS }, { ent: TEST_ALPHA }, { ent: TEST_BETA }]),
		);
		const set = await getEntitlements(db, "u1");
		expect(set).toEqual(new Set([ADMIN_USERS, TEST_ALPHA, TEST_BETA]));
	});

	it("duplicate keys collapse — two roles granting the same key yield it once", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(
			makeRowList([{ ent: ADMIN_USERS }, { ent: ADMIN_USERS }, { ent: TEST_ALPHA }]),
		);
		const set = await getEntitlements(db, "u1");
		expect(set.size).toBe(2);
		expect(set.has(ADMIN_USERS)).toBe(true);
	});

	it("zero rows → empty set (no roles granted)", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(makeRowList([]));
		const set = await getEntitlements(db, "u9");
		expect(set.size).toBe(0);
		expect(logEvent).not.toHaveBeenCalled();
	});

	it("unknown keys are filtered OUT (still fail-closed) AND logged as entitlements_unknown_key (CR-3)", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(makeRowList([{ ent: "admin.zombo" }, { ent: ADMIN_USERS }]));
		const set = await getEntitlements(db, "u1");
		// the typo'd grant must not open ANY door…
		expect(set).toEqual(new Set([ADMIN_USERS]));
		// …but it must not vanish silently either — the 404ing user needs a signal
		expect(logEvent).toHaveBeenCalledWith("entitlements_unknown_key", {
			key: "admin.zombo",
			userId: "u1",
		});
		expect(logEvent).toHaveBeenCalledTimes(1);
	});
});

describe("H2 requireEntitlement — both directions (fail CLOSED, D4)", () => {
	it("happy path: grants admin.users and RETURNS { userId, entitlements } — the return is load-bearing (CR-1)", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(makeRowList([{ ent: ADMIN_USERS }]));
		expect((await getEntitlements(db, "u1")).has(ADMIN_USERS)).toBe(true);
		const result = await requireEntitlement(db, "u1", ADMIN_USERS);
		expect(result.userId).toBe("u1");
		expect(result.entitlements).toBeInstanceOf(Set);
		expect(result.entitlements.has(ADMIN_USERS)).toBe(true);
	});

	it("degraded: rejected query → EMPTY set; entitlements_degraded logs the CAUSE message, never drizzle's userId-bearing wrapper (CR-4)", async () => {
		const userId = "6d5f0b2a-user-under-test";
		const driver = new Error("permission denied for table user_roles");
		// mimic drizzle's wrapping: outer message embeds the query text + params
		// (i.e. the userId), the actual driver failure hides in .cause
		const wrapper = new Error(
			`Failed query: SELECT DISTINCT unnest(r.entitlements) AS ent FROM lumen.user_roles ur JOIN lumen.roles r ON r.slug = ur.role_slug WHERE ur.user_id = $1\nparams: ${userId}`,
			{ cause: driver },
		);
		const { db, execute } = fakeDb();
		execute.mockRejectedValue(wrapper);
		const set = await getEntitlements(db, userId);
		expect(set.size).toBe(0);
		expect(logEvent).toHaveBeenCalledWith("entitlements_degraded", {
			message: "permission denied for table user_roles",
			userId,
		});
		// the message field is the CAUSE, not the wrapper: no query text, no userId leak
		const [, fields] = vi.mocked(logEvent).mock.calls[0]!;
		expect(String((fields as { message: unknown }).message)).not.toContain(userId);
		// userId rides as its own deliberate field instead
		expect((fields as { userId: unknown }).userId).toBe(userId);
	});

	it("degraded: a rejection WITHOUT .cause falls back to the error's own message", async () => {
		const { db, execute } = fakeDb();
		execute.mockRejectedValue(new Error("connection terminated"));
		const set = await getEntitlements(db, "u1");
		expect(set.size).toBe(0);
		expect(logEvent).toHaveBeenCalledWith("entitlements_degraded", {
			message: "connection terminated",
			userId: "u1",
		});
	});

	it("throws 404 for null / undefined / empty-string userId WITHOUT touching the db (CR-9)", async () => {
		for (const bad of [null, undefined, ""]) {
			const { db, execute } = fakeDb();
			await expect(
				requireEntitlement(db, bad as unknown as string | null, ADMIN_USERS),
			).rejects.toMatchObject({ init: { status: 404 } });
			expect(execute).not.toHaveBeenCalled();
		}
	});

	it("throws 404 — NOT 403 (D10: don't confirm the route exists) — when the entitlement is missing", async () => {
		const { db, execute } = fakeDb();
		// a user WITH roles, just not the required key
		execute.mockResolvedValue(makeRowList([{ ent: TEST_ALPHA }]));
		let thrown: { init?: { status?: number } } | undefined;
		try {
			await requireEntitlement(db, "u1", ADMIN_USERS);
		} catch (e) {
			thrown = e as typeof thrown;
		}
		// data(null, {status}) throws a DataWithResponseInit — status lives on .init
		expect(thrown?.init?.status).toBe(404);
		expect(thrown?.init?.status).not.toBe(403);
	});

	it("throws 404 on a degraded roles load — a DB blip must never open the admin door", async () => {
		const { db, execute } = fakeDb();
		execute.mockRejectedValue(new Error("timeout", { cause: new Error("socket hang up") }));
		await expect(requireEntitlement(db, "u1", ADMIN_USERS)).rejects.toMatchObject({
			init: { status: 404 },
		});
	});

	it("is awaitable-shaped: the unawaited call is a bare Promise with no userId (the CR-1 hazard)", async () => {
		const { db, execute } = fakeDb();
		execute.mockResolvedValue(makeRowList([{ ent: ADMIN_USERS }]));
		const pending = requireEntitlement(db, "u1", ADMIN_USERS);
		expect(typeof pending.then).toBe("function");
		// a forgotten `await` yields this — no userId — so consumers fail to
		// compile instead of running the gated query while the 404 floats
		expect("userId" in pending).toBe(false);
		await pending;
	});
});
