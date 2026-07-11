import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// Route-level harness (user-roles H3/H3b/H4/H4b/H5): mock the auth boundary
// and the db, exercise the REAL loader + real entitlements gate + real query
// builder. SQL is compiled with PgDialect so assertions run against what
// Postgres would actually receive (text + bound params).
const { getSessionUser } = vi.hoisted(() => ({
	getSessionUser: vi.fn(),
}));

vi.mock("~/lib/auth.server", async (importOriginal) => {
	const actual = await importOriginal<typeof import("~/lib/auth.server")>();
	return { ...actual, getSessionUser };
});

import { loader } from "../admin.users";
import {
	PAGE_SIZE,
	decodeCursor,
	encodeCursor,
	escapeLike,
	parseSort,
} from "~/lib/admin-users.server";

const dialect = new PgDialect();
const compile = (q: SQL) => dialect.sqlToQuery(q);

function makeUserRow(i: number) {
	const created = new Date(Date.UTC(2026, 0, 1 + i));
	return {
		id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
		email: `user${i}@example.com`,
		display_name: `User ${i}`,
		full_name: null,
		created_at: created,
		last_sign_in_at: new Date(0), // COALESCE'd epoch sentinel = never
		is_confirmed: true,
		is_banned: false,
		is_anonymous: false,
		is_deleted: false,
		roles: [] as string[],
		// the u.<sortcol>::text projection the loader mints the cursor from (B2)
		sort_key: created.toISOString(),
	};
}

/** db.execute mock answering, in order: entitlements → page → count → roles
 * catalog (the loader's full page-1 sequence). */
function makeDb(opts: { entitlements?: string[]; pageRows?: unknown[] } = {}) {
	const { entitlements = ["admin.users"], pageRows = [] } = opts;
	const execute = vi.fn(async (q: SQL) => {
		const sql = compile(q).sql;
		if (sql.includes("lumen.user_roles ur") && sql.includes("unnest")) {
			return entitlements.map((ent) => ({ ent }));
		}
		if (sql.includes("count(*)")) return [{ n: pageRows.length }];
		if (sql.includes("FROM lumen.roles")) return [{ slug: "admin", label: "Administrator" }];
		return pageRows;
	});
	return { execute };
}

function makeArgs(search = "", db = makeDb()) {
	return {
		params: {},
		request: new Request(`https://x/admin/users${search}`),
		context: { db, cloudflare: { env: {}, ctx: {} } },
	} as never;
}

beforeEach(() => {
	vi.clearAllMocks();
	getSessionUser.mockResolvedValue({
		user: { id: "admin-1", email: "abram@soar.com" },
		headers: new Headers(),
	});
});

describe("H3 admin loader — the gate runs first", () => {
	it("anonymous → 404 and the db is NEVER touched", async () => {
		getSessionUser.mockResolvedValue({ user: null, headers: new Headers() });
		const db = makeDb();
		await expect(loader(makeArgs("", db))).rejects.toMatchObject({ init: { status: 404 } });
		expect(db.execute).not.toHaveBeenCalled();
	});

	it("signed-in NON-admin → 404 after ONLY the roles query — no user query runs, no PII leaves", async () => {
		const db = makeDb({ entitlements: [] });
		await expect(loader(makeArgs("", db))).rejects.toMatchObject({ init: { status: 404 } });
		expect(db.execute).toHaveBeenCalledTimes(1);
		const gateSql = compile(db.execute.mock.calls[0][0]).sql;
		expect(gateSql).toContain("lumen.user_roles");
		expect(gateSql).not.toContain("app_users");
	});

	it("a forgotten await on the gate cannot pass: the loader consumes the load-bearing return (CR-1)", async () => {
		// the 404 above proves the runtime path; this pins the contract shape —
		// requireEntitlement resolves to the consumed {userId}, not void
		const db = makeDb({ pageRows: [makeUserRow(1)] });
		const res = (await loader(makeArgs("", db))) as { data: { viewer: string } };
		expect(res.data.viewer).toBe("admin-1");
	});

	it("admin → page query is shaped right: view name, 3-column ILIKE, keyset WHERE, no OFFSET", async () => {
		const db = makeDb({ pageRows: [makeUserRow(1)] });
		await loader(makeArgs("?q=nephi", db));
		const pageSql = compile(db.execute.mock.calls[1][0]).sql;
		expect(pageSql).toContain("lumen.app_users");
		expect(pageSql.match(/ILIKE/g)).toHaveLength(3); // email, display_name, full_name
		expect(pageSql).toMatch(/ESCAPE/);
		expect(pageSql).not.toMatch(/OFFSET/i);
		expect(pageSql).toMatch(/ORDER BY u\.created_at DESC, u\.id DESC/);
		// search text rides as a BOUND param, never interpolated
		const { params } = compile(db.execute.mock.calls[1][0]);
		expect(params).toContain("%nephi%");
		expect(pageSql).not.toContain("nephi");
	});

	it("sort/filter params compose: allow-listed sort col, role EXISTS, status column", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs("?sort=email&dir=asc&role=admin&status=banned", db));
		const { sql, params } = compile(db.execute.mock.calls[1][0]);
		expect(sql).toMatch(/ORDER BY u\.email ASC, u\.id ASC/);
		expect(sql).toContain("EXISTS (SELECT 1 FROM lumen.user_roles ur");
		expect(sql).toContain("u.is_banned = true");
		expect(params).toContain("admin");
	});

	it("an unknown sort/dir falls back to the default allow-list entry, never into SQL", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs("?sort=raw_user_meta_data&dir=;DROP", db));
		const { sql } = compile(db.execute.mock.calls[1][0]);
		expect(sql).toMatch(/ORDER BY u\.created_at DESC/);
		expect(sql).not.toContain("raw_user_meta_data");
		expect(sql).not.toContain("DROP");
	});
});

describe("H3b — cursor pages are lean", () => {
	it("page 1 (no cursor): entitlements + page + count + roles catalog", async () => {
		const db = makeDb({ pageRows: [] });
		const res = (await loader(makeArgs("", db))) as { data: { count: number | null; rolesCatalog: unknown } };
		expect(db.execute).toHaveBeenCalledTimes(4);
		expect(res.data.count).toBe(0);
		expect(res.data.rolesCatalog).toEqual([{ slug: "admin", label: "Administrator" }]);
	});

	it("cursor page: entitlements + the ONE keyset SELECT — count and catalog are skipped", async () => {
		const db = makeDb({ pageRows: [] });
		const cursor = encodeCursor({
			v: 1,
			s: "created",
			d: "desc",
			k: "2026-01-05T00:00:00.000Z",
			id: makeUserRow(5).id,
		});
		const res = (await loader(makeArgs(`?cursor=${cursor}`, db))) as {
			data: { count: number | null; rolesCatalog: unknown };
		};
		expect(db.execute).toHaveBeenCalledTimes(2);
		const sqls = db.execute.mock.calls.map((c) => compile(c[0]).sql);
		expect(sqls.some((s) => s.includes("count(*)"))).toBe(false);
		expect(res.data.count).toBeNull();
		expect(res.data.rolesCatalog).toBeNull();
	});
});

describe("H4 keyset pagination", () => {
	it("N+1 fetch: a full page mints nextCursor from the LAST VISIBLE row (not the peeked one)", async () => {
		const db = makeDb({ pageRows: Array.from({ length: PAGE_SIZE + 1 }, (_, i) => makeUserRow(i + 1)) });
		const res = (await loader(makeArgs("", db))) as {
			data: { rows: unknown[]; nextCursor: string | null };
		};
		expect(res.data.rows).toHaveLength(PAGE_SIZE);
		const c = decodeCursor(res.data.nextCursor, "created", "desc");
		expect(c).not.toBeNull();
		expect(c!.id).toBe(makeUserRow(PAGE_SIZE).id);
		expect(c!.k).toBe(makeUserRow(PAGE_SIZE).created_at.toISOString());
	});

	it("a short page → nextCursor null (explicit end)", async () => {
		const db = makeDb({ pageRows: [makeUserRow(1), makeUserRow(2)] });
		const res = (await loader(makeArgs("", db))) as { data: { nextCursor: string | null } };
		expect(res.data.nextCursor).toBeNull();
	});

	it("a follow page's WHERE excludes the seen boundary via row comparison in the sort direction", async () => {
		const db = makeDb({ pageRows: [] });
		const boundary = makeUserRow(25);
		const cursor = encodeCursor({
			v: 1,
			s: "created",
			d: "desc",
			k: boundary.created_at.toISOString(),
			id: boundary.id,
		});
		await loader(makeArgs(`?cursor=${cursor}`, db));
		const { sql, params } = compile(db.execute.mock.calls[1][0]);
		expect(sql).toMatch(/\(u\.created_at, u\.id\) < \(/); // desc → strictly before the boundary
		expect(params).toContain(boundary.created_at.toISOString());
		expect(params).toContain(boundary.id);
		// asc flips the comparison
		const dbAsc = makeDb({ pageRows: [] });
		const cursorAsc = encodeCursor({
			v: 1,
			s: "created",
			d: "asc",
			k: boundary.created_at.toISOString(),
			id: boundary.id,
		});
		await loader(makeArgs(`?sort=created&dir=asc&cursor=${cursorAsc}`, dbAsc));
		expect(compile(dbAsc.execute.mock.calls[1][0]).sql).toMatch(/\(u\.created_at, u\.id\) > \(/);
	});
});

describe("H4b — malformed cursors degrade to page 1, never throw", () => {
	it.each([
		["garbage", "not-base64url-json"],
		["wrong version", encodeCursor({ v: 1, s: "created", d: "desc", k: "x", id: "y" }).replace(/^/, "AAAA")],
		["non-object payload", btoa(JSON.stringify("hi"))],
	])("%s → decodeCursor null", (_label, raw) => {
		expect(decodeCursor(raw, "created", "desc")).toBeNull();
	});

	it("sort or dir mismatch → cursor discarded (minted under a different ordering)", () => {
		// valid values so we're testing the sort/dir gate, not the B3 value gate
		const c = {
			v: 1 as const,
			s: "created" as const,
			d: "desc" as const,
			k: "2026-01-26T00:00:00.000Z",
			id: "00000000-0000-4000-8000-000000000009",
		};
		expect(decodeCursor(encodeCursor(c), "created", "desc")).toEqual(c);
		expect(decodeCursor(encodeCursor(c), "email", "desc")).toBeNull();
		expect(decodeCursor(encodeCursor(c), "created", "asc")).toBeNull();
	});

	it("B3: valid-shape cursor with garbage VALUES → null (would 500 at the ::uuid/::timestamptz cast)", () => {
		const uuid = "00000000-0000-4000-8000-000000000001";
		// id not a uuid → the ::uuid cast would throw; must be rejected pre-query
		expect(
			decodeCursor(
				encodeCursor({ v: 1, s: "created", d: "desc", k: "2026-01-01 12:00:00+00", id: "not-a-uuid" }),
				"created",
				"desc",
			),
		).toBeNull();
		// k not timestamp-shaped for a timestamptz sort → the ::timestamptz cast would throw
		expect(
			decodeCursor(encodeCursor({ v: 1, s: "created", d: "desc", k: "banana", id: uuid }), "created", "desc"),
		).toBeNull();
		// a fully valid microsecond cursor still decodes (round-trip)
		const good = {
			v: 1 as const,
			s: "created" as const,
			d: "desc" as const,
			k: "2026-01-01 12:00:00.123456+00",
			id: uuid,
		};
		expect(decodeCursor(encodeCursor(good), "created", "desc")).toEqual(good);
		// email sort: k is free text, but id must still be a uuid
		const emailC = { v: 1 as const, s: "email" as const, d: "asc" as const, k: "user@example.com", id: uuid };
		expect(decodeCursor(encodeCursor(emailC), "email", "asc")).toEqual(emailC);
		expect(decodeCursor(encodeCursor({ ...emailC, id: "y" }), "email", "asc")).toBeNull();
	});

	it("B3: a valid-shape/garbage-value cursor makes the loader behave as page 1, no throw", async () => {
		const db = makeDb({ pageRows: [] });
		const forged = encodeCursor({ v: 1, s: "created", d: "desc", k: "x", id: "y" });
		await expect(loader(makeArgs(`?cursor=${forged}`, db))).resolves.toBeTruthy();
		expect(db.execute).toHaveBeenCalledTimes(4); // full page-1 sequence, not a keyset page
		expect(compile(db.execute.mock.calls[1][0]).sql).not.toMatch(/\(u\.created_at, u\.id\)/);
	});

	it("loader with a corrupt cursor behaves as page 1: count runs, no keyset predicate, resolves fine", async () => {
		const db = makeDb({ pageRows: [] });
		await expect(loader(makeArgs("?cursor=%F0%9F%92%A9garbage", db))).resolves.toBeTruthy();
		expect(db.execute).toHaveBeenCalledTimes(4); // full page-1 sequence
		const pageSql = compile(db.execute.mock.calls[1][0]).sql;
		expect(pageSql).not.toMatch(/\(u\.created_at, u\.id\)/);
	});

	it("a cursor minted under another sort is discarded when the URL sort changed (H4b)", async () => {
		const db = makeDb({ pageRows: [] });
		const cursor = encodeCursor({ v: 1, s: "created", d: "desc", k: "2026-01-01", id: "x" });
		await loader(makeArgs(`?sort=email&dir=asc&cursor=${cursor}`, db));
		expect(db.execute).toHaveBeenCalledTimes(4); // treated as page 1
		expect(compile(db.execute.mock.calls[1][0]).sql).not.toMatch(/\(u\.email, u\.id\)/);
	});
});

describe("H5 search sanitization — backslash FIRST", () => {
	it("escapes \\ before % and _ (the order is load-bearing — adversarial item 5)", () => {
		// q = 100%_\x  →  100\%\_\\x  (backslash doubled FIRST, then wildcards)
		expect(escapeLike("100%_\\x")).toBe("100\\%\\_\\\\x");
		// wrong-order result would be 100\\%\\_\\\\x-style double-escaping;
		// pin the three singles too
		expect(escapeLike("%")).toBe("\\%");
		expect(escapeLike("_")).toBe("\\_");
		expect(escapeLike("\\")).toBe("\\\\");
		expect(escapeLike("plain")).toBe("plain");
	});

	it("user wildcards arrive escaped INSIDE the bound param — no match-everything injection", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs(`?q=${encodeURIComponent("50%_")}`, db));
		const { params } = compile(db.execute.mock.calls[1][0]);
		expect(params).toContain("%50\\%\\_%");
	});

	it("empty q → no search predicate at all", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs("?q=", db));
		expect(compile(db.execute.mock.calls[1][0]).sql).not.toMatch(/ILIKE/);
	});
});

describe("parseSort — the allow-list is total", () => {
	it("defaults and clamps", () => {
		expect(parseSort(null, null)).toEqual({ sort: "created", dir: "desc" });
		expect(parseSort("email", "asc")).toEqual({ sort: "email", dir: "asc" });
		expect(parseSort("evil", "sideways")).toEqual({ sort: "created", dir: "desc" });
	});

	it("B1: prototype-chain keys do NOT pass the allow-list (Object.hasOwn, not `in`)", () => {
		// `key in SORTS` walked the prototype chain; these all resolved truthy and
		// fed an Object.prototype member into sql.raw → ORDER BY u.undefined → 500
		for (const k of ["toString", "valueOf", "constructor", "__proto__", "hasOwnProperty", "isPrototypeOf"]) {
			expect(parseSort(k, "asc").sort).toBe("created");
		}
	});
});

describe("B1 — prototype-key params never reach sql.raw", () => {
	it("?sort=toString → default ORDER BY, never `u.undefined`", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs("?sort=toString", db));
		const pageSql = compile(db.execute.mock.calls[1][0]).sql;
		expect(pageSql).toMatch(/ORDER BY u\.created_at DESC/);
		expect(pageSql).not.toContain("undefined");
	});

	it("?status=constructor → no status predicate, never the Object function in WHERE", async () => {
		const db = makeDb({ pageRows: [] });
		await loader(makeArgs("?status=constructor", db));
		const pageSql = compile(db.execute.mock.calls[1][0]).sql;
		expect(pageSql).not.toContain("Object");
		expect(pageSql).not.toMatch(/is_confirmed = true|is_banned = true|is_anonymous = true/);
	});

	it("?sort=__proto__&cursor=... → cursor's proto-key sort is rejected too (page 1)", async () => {
		const db = makeDb({ pageRows: [] });
		// even a cursor claiming s:"__proto__" must not decode
		expect(
			decodeCursor(
				encodeCursor({
					v: 1,
					s: "__proto__" as never,
					d: "desc",
					k: "2026-01-01T00:00:00.000Z",
					id: "00000000-0000-4000-8000-000000000001",
				}),
				"created",
				"desc",
			),
		).toBeNull();
	});
});

describe("B2 — keyset cursor preserves full microsecond precision", () => {
	it("mints k from the ::text sort_key, not a millisecond-truncated Date", async () => {
		// a full page whose boundary row carries a microsecond timestamp shared
		// by its ties (the bulk-insert case desc pages used to skip)
		const micros = "2026-01-01 12:00:00.123456+00";
		const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => ({
			...makeUserRow(i + 1),
			sort_key: micros,
		}));
		const db = makeDb({ pageRows: rows });
		const res = (await loader(makeArgs("", db))) as { data: { nextCursor: string | null } };
		const c = decodeCursor(res.data.nextCursor, "created", "desc");
		expect(c).not.toBeNull();
		// the microseconds survive — NOT the lossy 2026-01-01T12:00:00.123Z Date form
		expect(c!.k).toBe(micros);
		expect(c!.k).not.toMatch(/\.\d{3}Z$/);
	});

	it("the returned rows do NOT leak the internal sort_key onto the wire", async () => {
		const db = makeDb({ pageRows: [makeUserRow(1)] });
		const res = (await loader(makeArgs("", db))) as { data: { rows: unknown[] } };
		expect(res.data.rows[0]).not.toHaveProperty("sort_key");
	});
});
