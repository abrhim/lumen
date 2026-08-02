import { sql } from "drizzle-orm";
import { data } from "react-router";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { logEvent } from "./log.server";
import { type Entitlement, isKnownEntitlement } from "./entitlements-keys";

/**
 * Role-based entitlements (plan D4/D5). Fail-CLOSED: any error loading roles
 * yields an EMPTY entitlement set — a DB blip must never open a gated door.
 * lumen.user_roles ⨝ lumen.roles is the single source of truth (no JWT claim
 * in v1, D3). Entitlement keys live in entitlements-keys.ts (F13) so scripts
 * validate grants against the same list.
 */

export { ENTITLEMENTS, ADMIN_USERS, ADMIN_COLLECTIONS, isKnownEntitlement } from "./entitlements-keys";
export type { Entitlement } from "./entitlements-keys";

/**
 * The union of every entitlement granted by the user's roles. ONE all-or-
 * nothing query wrapped in a single try (postgres.js buffers the full result;
 * the awaited query rejects, never returns a partial row set — so streaming
 * APIs (.cursor()/.forEach()) are forbidden here) → empty Set on any failure.
 */
export async function getEntitlements(
	db: PostgresJsDatabase,
	userId: string,
): Promise<Set<Entitlement>> {
	try {
		const rows = (await db.execute(
			sql`SELECT DISTINCT unnest(r.entitlements) AS ent
			    FROM lumen.user_roles ur
			    JOIN lumen.roles r ON r.slug = ur.role_slug
			    WHERE ur.user_id = ${userId}`,
		)) as unknown as { ent: string }[];
		const set = new Set<Entitlement>();
		for (const row of rows) {
			if (isKnownEntitlement(row.ent)) set.add(row.ent);
			// a granted-but-unknown key must not vanish silently: the user 404s
			// with zero signal otherwise. Still fail-closed — log, don't grant (CR-3)
			else logEvent("entitlements_unknown_key", { key: row.ent, userId });
		}
		return set;
	} catch (err) {
		// log the driver error (err.cause), not drizzle's wrapper string — the
		// wrapper embeds the query text + params (leaks the userId into the
		// message) and buries the actual failure (CR-4). userId rides as its
		// own deliberate field instead.
		const cause = err instanceof Error && err.cause !== undefined ? err.cause : err;
		logEvent("entitlements_degraded", {
			message: cause instanceof Error ? cause.message : String(cause),
			userId,
		});
		return new Set();
	}
}

/** The two roles (2026-08-01). `admin` carries the entitlements; `user` is
 * the deliberately powerless floor — and the DEFAULT: a signed-in account
 * with no lumen.user_roles row IS a user. Resolving the default here rather
 * than writing a row per account means no trigger on auth.users and no
 * backfill that can drift out of sync. */
export const ADMIN_ROLE = "admin";
export const DEFAULT_ROLE = "user";

/**
 * The user's role slugs. Signed out is [] — no role at all; signed in with
 * no assignment is [DEFAULT_ROLE].
 *
 * These DESCRIBE a user (for an admin list, or to decide whether to render
 * an admin link). They do NOT gate: the gate is requireEntitlement(), so
 * there stays exactly ONE enforcement path and adding a role can never
 * quietly become a second way in. Fail-CLOSED like getEntitlements — any
 * error resolves to the floor role, never to admin.
 */
export async function getRoles(
	db: PostgresJsDatabase,
	userId: string | null,
): Promise<string[]> {
	if (!userId) return [];
	try {
		const rows = (await db.execute(
			sql`SELECT role_slug FROM lumen.user_roles WHERE user_id = ${userId}`,
		)) as unknown as { role_slug: string }[];
		const slugs = rows.map((r) => r.role_slug).filter(Boolean);
		return slugs.length > 0 ? slugs : [DEFAULT_ROLE];
	} catch (err) {
		// same discipline as getEntitlements: log the driver error, not
		// drizzle's wrapper (it embeds the query text + the userId)
		const cause = err instanceof Error && err.cause !== undefined ? err.cause : err;
		logEvent("roles_degraded", {
			message: cause instanceof Error ? cause.message : String(cause),
			userId,
		});
		return [DEFAULT_ROLE];
	}
}

/** Describes, does not gate — see getRoles. */
export async function hasRole(
	db: PostgresJsDatabase,
	userId: string | null,
	slug: string,
): Promise<boolean> {
	return (await getRoles(db, userId)).includes(slug);
}

/**
 * Gate a loader on an entitlement. Throws a 404 (NOT 403 — don't confirm the
 * route exists to non-admins, plan D10) when absent. MUST be the loader's
 * first statement so no gated query runs for the unentitled (plan D4/H3).
 *
 * The return value is LOAD-BEARING (CR-1): consume it —
 *   const { userId } = await requireEntitlement(db, user?.id ?? null, ADMIN_USERS);
 * A forgotten `await` then fails to compile (a Promise has no `userId`)
 * instead of letting the gated query run while the 404 dies as an unhandled
 * rejection. Never call this as a bare statement.
 */
export async function requireEntitlement(
	db: PostgresJsDatabase,
	userId: string | null,
	entitlement: Entitlement,
): Promise<{ userId: string; entitlements: Set<Entitlement> }> {
	// `!userId` (not `=== null`): undefined/"" must gate identically instead
	// of falling through to a noisy false-`degraded` DB round trip (CR-9)
	if (!userId) throw data(null, { status: 404 });
	const entitlements = await getEntitlements(db, userId);
	if (!entitlements.has(entitlement)) throw data(null, { status: 404 });
	return { userId, entitlements };
}
