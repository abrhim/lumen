import { sql, type SQL } from "drizzle-orm";
import { data } from "react-router";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { classifyReadError } from "./db-errors.server";
import { logEvent } from "./log.server";

/**
 * Admin user-list data access (plan D6/D7/D8). Server-driven search + filters
 * + sort + KEYSET pagination over lumen.app_users (the D1 bridge view — every
 * sortable column is COALESCEd non-null there, D2, which is what makes the
 * row-comparison keyset total). Pure helpers exported for the H4/H4b/H5
 * harness; loadUsersPage for the loader (H3/H3b).
 */

export const PAGE_SIZE = 25;

/** Sort allow-list (D6): the SQL column is chosen HERE, never from the
 * cursor or any request string. */
export const SORTS = {
	created: { col: "created_at", cast: "timestamptz" },
	seen: { col: "last_sign_in_at", cast: "timestamptz" },
	email: { col: "email", cast: "text" },
} as const;
export type SortKey = keyof typeof SORTS;
export type SortDir = "asc" | "desc";

// Object.hasOwn, NOT `key in MAP` (B1): `in` walks the prototype chain, so
// `?sort=toString`/`__proto__`/`constructor` would resolve to an Object.proto
// member and feed `undefined`/a function into sql.raw → `ORDER BY u.undefined`
// → a 500 for an entitled admin. hasOwn is own-key-only.
export function parseSort(sort: string | null, dir: string | null): { sort: SortKey; dir: SortDir } {
	return {
		sort: sort !== null && Object.hasOwn(SORTS, sort) ? (sort as SortKey) : "created",
		dir: dir === "asc" ? "asc" : "desc",
	};
}

/** ILIKE escape (D7/H5). Backslash FIRST — escaping %/_ before \ would
 * re-escape the backslashes those substitutions insert (adversarial-authz
 * item 5 has the proof). The result is always used as a BOUND param. */
export function escapeLike(q: string): string {
	return q.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** Opaque keyset cursor (D6): base64url of {v,s,d,k,id}. Unsigned is fine —
 * k/id only ever feed BOUND params and s/d must match the request's validated
 * sort or the cursor is discarded; worst-case forgery re-paginates a result
 * set the caller is already entitled to. */
export interface Cursor {
	v: 1;
	s: SortKey;
	d: SortDir;
	k: string;
	id: string;
}

// value-shape guards (B3): a structurally-valid cursor carrying garbage values
// (k:"x", id:"y") would otherwise pass decode and 500 at the ::timestamptz /
// ::uuid cast — violating D6's "bad → page-1-never-throws". id is always a
// view uuid; k for a timestamptz sort is Postgres timestamptz text (see the
// ::text projection in loadUsersPage, B2).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMPTZ_RE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?$/;

function b64urlEncode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = "";
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(raw: string): string {
	const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
	const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}

export function encodeCursor(c: Cursor): string {
	return b64urlEncode(JSON.stringify(c));
}

/** H4b: NEVER throws — malformed, wrong-version, sort/dir-mismatched, OR
 * value-garbage cursors all degrade to null (page 1). A stale bookmark is not
 * an error, and a forged cursor must not reach a SQL cast (B3). */
export function decodeCursor(raw: string | null, sort: SortKey, dir: SortDir): Cursor | null {
	if (!raw) return null;
	try {
		const c = JSON.parse(b64urlDecode(raw));
		// Object.hasOwn, not `c.s in SORTS` (B1): a prototype-key `s` must not pass
		if (c?.v !== 1 || !Object.hasOwn(SORTS, c.s) || (c.d !== "asc" && c.d !== "desc")) return null;
		if (typeof c.k !== "string" || typeof c.id !== "string") return null;
		// minted under a different sort/dir → boundary is meaningless: restart
		if (c.s !== sort || c.d !== dir) return null;
		// value-shape (B3): reject anything that would 500 at the cast
		if (!UUID_RE.test(c.id)) return null;
		if (SORTS[c.s as SortKey].cast === "timestamptz" && !TIMESTAMPTZ_RE.test(c.k)) return null;
		return c as Cursor;
	} catch {
		return null;
	}
}

const STATUSES = { confirmed: "is_confirmed", banned: "is_banned", anonymous: "is_anonymous" } as const;
export type StatusKey = keyof typeof STATUSES;

export interface AdminUserRow {
	id: string;
	email: string;
	display_name: string | null;
	full_name: string | null;
	created_at: Date;
	last_sign_in_at: Date;
	is_confirmed: boolean;
	is_banned: boolean;
	is_anonymous: boolean;
	is_deleted: boolean;
	roles: string[];
}

export interface UsersPage {
	rows: AdminUserRow[];
	nextCursor: string | null;
	/** total under the current filters — page 1 only (H3b); null on cursor pages */
	count: number | null;
	/** role catalog for the filter select — page 1 only; null on cursor pages */
	rolesCatalog: { slug: string; label: string }[] | null;
	/** serialized filter identity, echoed for the client's append race-guard (D6) */
	epoch: string;
	q: string;
	role: string;
	status: StatusKey | "";
	sort: SortKey;
	dir: SortDir;
}

interface PageParams {
	q: string;
	role: string;
	status: StatusKey | "";
	sort: SortKey;
	dir: SortDir;
	cursor: Cursor | null;
}

// Postgres SQLSTATEs for a failed cast of a forged cursor value (B3):
// 22007 invalid_datetime_format, 22008 datetime_field_overflow, 22P02
// invalid_text_representation (bad uuid). A shape-valid but value-invalid `k`
// (e.g. month 13) slips past decodeCursor's regex and only Postgres can reject
// it — so the cast error, and ONLY the cast error, degrades to page 1.
const CURSOR_CAST_CODES = new Set(["22007", "22008", "22P02"]);

/**
 * One page of the admin list. Page 1 (no cursor) additionally returns the
 * count + role catalog; cursor pages are a single keyset SELECT (H3b).
 * MUST be called only after requireEntitlement has passed (H3).
 *
 * D6 never-throw (B3): a value-invalid cursor that only Postgres can reject
 * degrades to page 1 rather than surfacing a 500. The fallback is scoped to
 * cast SQLSTATEs so a real DB fault still surfaces (and a fetcher — which only
 * ever sends OUR minted cursors — never silently duplicates page 1).
 */
export async function loadUsersPage(
	db: PostgresJsDatabase,
	searchParams: URLSearchParams,
): Promise<UsersPage> {
	const q = (searchParams.get("q") ?? "").trim().slice(0, 200);
	const roleRaw = searchParams.get("role") ?? "";
	const role = /^[a-z][a-z0-9-]*$/.test(roleRaw) ? roleRaw : "";
	const statusRaw = searchParams.get("status") ?? "";
	// Object.hasOwn, not `statusRaw in STATUSES` (B1)
	const status: StatusKey | "" = Object.hasOwn(STATUSES, statusRaw) ? (statusRaw as StatusKey) : "";
	const { sort, dir } = parseSort(searchParams.get("sort"), searchParams.get("dir"));
	const cursor = decodeCursor(searchParams.get("cursor"), sort, dir);

	try {
		return await runPage(db, { q, role, status, sort, dir, cursor });
	} catch (err) {
		const code =
			err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
		if (cursor && CURSOR_CAST_CODES.has(code)) {
			logEvent("admin_cursor_rejected", { code, sort });
			return runPage(db, { q, role, status, sort, dir, cursor: null });
		}
		// Everything else used to be re-thrown bare, so the route rendered one
		// generic message whatever the cause and left no trace at all (issue #3).
		// Name the class instead: the route's copy turns on it, and an exhausted
		// pool now leaves a record. Cause + SQLSTATE only — no PG text, which
		// carries the offending VALUE (B13/CP-14, same rule notes.server.ts keeps).
		const failure = classifyReadError(err);
		logEvent("admin_users_degraded", {
			cause: failure.cause,
			pg_code: failure.pgCode,
			transient: failure.transient,
		});
		// NOT a retry: retrying into an exhausted pool is what deepens it. This
		// only tells the boundary which sentence is true.
		throw data(
			{ cause: failure.cause, transient: failure.transient },
			{ status: failure.transient ? 503 : 500 },
		);
	}
}

async function runPage(db: PostgresJsDatabase, p: PageParams): Promise<UsersPage> {
	const { q, role, status, sort, dir, cursor } = p;
	const epoch = JSON.stringify([q, role, status, sort, dir]);

	const filters: SQL[] = [];
	if (q !== "") {
		const like = `%${escapeLike(q)}%`;
		filters.push(
			sql`(u.email ILIKE ${like} ESCAPE '\\' OR u.display_name ILIKE ${like} ESCAPE '\\' OR u.full_name ILIKE ${like} ESCAPE '\\')`,
		);
	}
	if (role !== "") {
		filters.push(
			sql`EXISTS (SELECT 1 FROM lumen.user_roles ur WHERE ur.user_id = u.id AND ur.role_slug = ${role})`,
		);
	}
	if (status !== "") {
		// column name from the server-side STATUSES map, never the request
		filters.push(sql`u.${sql.raw(STATUSES[status])} = true`);
	}

	const S = SORTS[sort];
	const page: SQL[] = [...filters];
	if (cursor) {
		const k = S.cast === "timestamptz" ? sql`${cursor.k}::timestamptz` : sql`${cursor.k}`;
		page.push(
			dir === "desc"
				? sql`(u.${sql.raw(S.col)}, u.id) < (${k}, ${cursor.id}::uuid)`
				: sql`(u.${sql.raw(S.col)}, u.id) > (${k}, ${cursor.id}::uuid)`,
		);
	}
	const wherePage = page.length > 0 ? sql`WHERE ${sql.join(page, sql` AND `)}` : sql``;
	const whereCount = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;
	const order = sql.raw(
		`u.${S.col} ${dir === "desc" ? "DESC" : "ASC"}, u.id ${dir === "desc" ? "DESC" : "ASC"}`,
	);

	// N+1 to know whether a next page exists (platform-data keyset spec).
	// sort_key = the sort column as FULL-PRECISION text (B2): postgres.js parses
	// timestamptz into a millisecond JS Date, so minting the cursor from a Date
	// dropped the microseconds `now()` writes → desc pages skipped boundary ties,
	// asc pages duplicated them. The text round-trips losslessly through the
	// ${k}::timestamptz bound-param compare above.
	// roles rides as to_jsonb, NOT as a bare text[]. db.server.ts sets
	// fetch_types:false to save a round trip per request, and without the type
	// catalogue postgres.js cannot parse an array — it returns Postgres's
	// literal as the STRING '{admin}'. '{}' is then a 2-character string, so a
	// length === 0 guard passes and .map explodes on the first row. That is
	// exactly how this page 500'd for the first admin ever to reach it. jsonb
	// has a builtin OID the driver parses whether or not types were fetched.
	const fetched = (await db.execute(
		sql`SELECT u.id, u.email, u.display_name, u.full_name, u.created_at,
		           u.last_sign_in_at, u.is_confirmed, u.is_banned, u.is_anonymous,
		           COALESCE(to_jsonb(rr.roles), '[]'::jsonb) AS roles,
		           u.${sql.raw(S.col)}::text AS sort_key
		    FROM lumen.app_users u
		    LEFT JOIN (
		      SELECT user_id, array_agg(role_slug ORDER BY role_slug) AS roles
		      FROM lumen.user_roles GROUP BY user_id
		    ) rr ON rr.user_id = u.id
		    ${wherePage}
		    ORDER BY ${order}
		    LIMIT ${PAGE_SIZE + 1}`,
	)) as unknown as (AdminUserRow & { sort_key: string })[];

	const visible = fetched.slice(0, PAGE_SIZE);
	const last = visible[visible.length - 1];
	const nextCursor =
		fetched.length > PAGE_SIZE && last
			? encodeCursor({ v: 1, s: sort, d: dir, k: last.sort_key, id: last.id })
			: null;
	// strip the internal sort_key from the wire (client never reads it)
	const rows: AdminUserRow[] = visible.map(({ sort_key: _sort_key, ...r }) => r);

	// page 1 only (H3b): the count + the filter catalog
	let count: number | null = null;
	let rolesCatalog: { slug: string; label: string }[] | null = null;
	if (!cursor) {
		const [c] = (await db.execute(
			sql`SELECT count(*)::int AS n FROM lumen.app_users u ${whereCount}`,
		)) as unknown as { n: number }[];
		count = c?.n ?? 0;
		rolesCatalog = (await db.execute(
			sql`SELECT slug, label FROM lumen.roles ORDER BY slug`,
		)) as unknown as { slug: string; label: string }[];
	}

	return { rows, nextCursor, count, rolesCatalog, epoch, q, role, status, sort, dir };
}
