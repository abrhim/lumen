import { sql, type SQL } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

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

export function parseSort(sort: string | null, dir: string | null): { sort: SortKey; dir: SortDir } {
	return {
		sort: sort !== null && sort in SORTS ? (sort as SortKey) : "created",
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

/** H4b: NEVER throws — malformed, wrong-version, or sort/dir-mismatched
 * cursors all degrade to null (page 1). A stale bookmark is not an error. */
export function decodeCursor(raw: string | null, sort: SortKey, dir: SortDir): Cursor | null {
	if (!raw) return null;
	try {
		const c = JSON.parse(b64urlDecode(raw));
		if (c?.v !== 1 || !(c.s in SORTS) || (c.d !== "asc" && c.d !== "desc")) return null;
		if (typeof c.k !== "string" || typeof c.id !== "string") return null;
		// minted under a different sort/dir → boundary is meaningless: restart
		if (c.s !== sort || c.d !== dir) return null;
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

/**
 * One page of the admin list. Page 1 (no cursor) additionally returns the
 * count + role catalog; cursor pages are a single keyset SELECT (H3b).
 * MUST be called only after requireEntitlement has passed (H3).
 */
export async function loadUsersPage(
	db: PostgresJsDatabase,
	searchParams: URLSearchParams,
): Promise<UsersPage> {
	const q = (searchParams.get("q") ?? "").trim().slice(0, 200);
	const roleRaw = searchParams.get("role") ?? "";
	const role = /^[a-z][a-z0-9-]*$/.test(roleRaw) ? roleRaw : "";
	const statusRaw = searchParams.get("status") ?? "";
	const status: StatusKey | "" = statusRaw in STATUSES ? (statusRaw as StatusKey) : "";
	const { sort, dir } = parseSort(searchParams.get("sort"), searchParams.get("dir"));
	const cursor = decodeCursor(searchParams.get("cursor"), sort, dir);
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

	// N+1 to know whether a next page exists (platform-data keyset spec)
	const fetched = (await db.execute(
		sql`SELECT u.id, u.email, u.display_name, u.full_name, u.created_at,
		           u.last_sign_in_at, u.is_confirmed, u.is_banned, u.is_anonymous,
		           u.is_deleted, COALESCE(rr.roles, '{}') AS roles
		    FROM lumen.app_users u
		    LEFT JOIN (
		      SELECT user_id, array_agg(role_slug ORDER BY role_slug) AS roles
		      FROM lumen.user_roles GROUP BY user_id
		    ) rr ON rr.user_id = u.id
		    ${wherePage}
		    ORDER BY ${order}
		    LIMIT ${PAGE_SIZE + 1}`,
	)) as unknown as AdminUserRow[];

	const rows = fetched.slice(0, PAGE_SIZE);
	const last = rows[rows.length - 1];
	const nextCursor =
		fetched.length > PAGE_SIZE && last
			? encodeCursor({
					v: 1,
					s: sort,
					d: dir,
					k:
						S.cast === "timestamptz"
							? new Date(last[S.col === "created_at" ? "created_at" : "last_sign_in_at"]).toISOString()
							: last.email,
					id: last.id,
				})
			: null;

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
