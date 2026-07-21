import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getPublicCollectionIds } from "@lumen/scripture";
import { ADMIN_COLLECTIONS, getEntitlements } from "./entitlements.server";

/**
 * Collection visibility (Phase B gate): a collection's surfaces are visible
 * when it is PUBLIC, or the viewer holds admin.collections (the preview path
 * — `collections.public=false` stays the kill switch and the flip stays a
 * deliberate act), or in local dev. Fail-closed: any lookup error reads as
 * "not public, not entitled".
 */
export interface CollectionAccess {
	publicIds: string[];
	entitled: boolean;
}

export async function getCollectionAccess(
	db: PostgresJsDatabase,
	userId: string | null,
): Promise<CollectionAccess> {
	const publicIds = await (getPublicCollectionIds(db) as Promise<string[]>).catch(
		() => [] as string[],
	);
	const entitled = userId ? (await getEntitlements(db, userId)).has(ADMIN_COLLECTIONS) : false;
	return { publicIds, entitled };
}

export function canViewCollection(access: CollectionAccess, collectionId: string): boolean {
	return access.publicIds.includes(collectionId) || access.entitled || import.meta.env.DEV;
}
