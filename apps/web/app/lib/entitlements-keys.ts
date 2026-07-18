/**
 * The single machine-readable source of truth for entitlement keys (F13/D5).
 * Dependency-free ON PURPOSE: imported by entitlements.server.ts (the
 * `Entitlement` union derives from `as const`) AND by scripts/grant-role.mjs
 * via the house `node --import tsx` header — one list, no drift, and grant-
 * time validation (D5) checks against the exact set the runtime gates on.
 */
export const ENTITLEMENTS = ["admin.users", "admin.collections"] as const;
export type Entitlement = (typeof ENTITLEMENTS)[number];

/** Named constants for greppability; call sites stay typo-safe either way via
 * the `Entitlement` union. */
export const ADMIN_USERS = "admin.users" as const satisfies Entitlement;
/** Gates the /admin/collections page (Phase B); granted by
 * migrate-media-collections.mjs in the SAME commit as this key (SEC-7). */
export const ADMIN_COLLECTIONS = "admin.collections" as const satisfies Entitlement;

export function isKnownEntitlement(key: string): key is Entitlement {
	return (ENTITLEMENTS as readonly string[]).includes(key);
}
