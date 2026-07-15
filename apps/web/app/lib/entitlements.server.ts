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

export { ENTITLEMENTS, ADMIN_USERS, isKnownEntitlement } from "./entitlements-keys";
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
