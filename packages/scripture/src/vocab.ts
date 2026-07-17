/**
 * Enforced data vocabulary — the single machine-readable source of truth for
 * entity types, PG edge rel_types, and collection tiers/categories
 * (media-collections design, 0b; supersedes the deleted @lumen/shared).
 *
 * EVIDENCE-BASED: the "live" groups mirror prod DISTINCTs (2026-07-17);
 * "planned" entries are declared here BEFORE their writer ships so ingest
 * validation and grant-time checks share one list (entitlements-keys F13
 * pattern). A value joins this file only when a writer exists or is planned —
 * never aspirationally. Drift gate: scripts/smoke-vocab.mjs (run after any
 * ingest; exits 2 on divergence in either direction).
 *
 * Dependency-free ON PURPOSE: imported by TS consumers and by plain-node
 * scripts via the house `node --import tsx` header.
 *
 * NOT covered here: Neo4j-side rel types (graph/get-neighborhood.ts
 * allow-lists include Neo4j-only types like PARALLELS/EXTENDS/CONTRASTS) —
 * reconciled during the graph-membership feature, not 0b.
 */

export const ENTITY_TYPES = [
	// live (prod, 2026-07-17)
	"artwork",
	"book",
	"chapter",
	"chapter_summary",
	"era",
	"event",
	"jst_reading",
	"naves_topic",
	"person",
	"place",
	"principle",
	"strongs_word",
	"symbol",
	"volume",
	// planned — media collections (writer: unshaken-ingest A1; content_segment
	// is the documented promotion door for segments, per the design doc)
	"content_item",
	"content_segment",
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const PG_REL_TYPES = [
	// live (prod, 2026-07-17)
	"ANCESTOR_OF",
	"APOSTLE_OF",
	"APPEARS_IN",
	"AT_VERSE",
	"CONTAINS",
	"COVERS",
	"CREATED",
	"CROSS_REF",
	"DEPICTS",
	"FEATURES",
	"GRANDPARENT_OF",
	"HAS_SUMMARY",
	"HAS_SYMBOL",
	"IN_VOLUME",
	"INVOLVES",
	"KILLED",
	"LOCATED_AT",
	"MARRIED_TO",
	"MASTER_OF",
	"MENTIONS",
	"PARENT_OF",
	"SETTING_OF",
	"SIBLING_OF",
	"SUMMARIZES",
	"TEACHER_OF",
	"TEACHES",
	"TYPIFIES",
	// planned — media collections (writer: unshaken-extraction A2)
	"DISCUSSES",
] as const;
export type PgRelType = (typeof PG_REL_TYPES)[number];

export const COLLECTION_TIERS = [
	// live
	"base",
	"app",
	"enrichment",
	// reserved — collections user-half (schema-ready via owner_id, no writer yet)
	"community",
	"personal",
] as const;
export type CollectionTier = (typeof COLLECTION_TIERS)[number];

export const COLLECTION_CATEGORIES = [
	// live
	"scripture",
	"reference",
	"art",
	"cross-references",
	"ai-generated",
	// planned — media collections (writer: unshaken-ingest A1)
	"podcast",
] as const;
export type CollectionCategory = (typeof COLLECTION_CATEGORIES)[number];

export function isEntityType(v: string): v is EntityType {
	return (ENTITY_TYPES as readonly string[]).includes(v);
}
export function isPgRelType(v: string): v is PgRelType {
	return (PG_REL_TYPES as readonly string[]).includes(v);
}
export function isCollectionTier(v: string): v is CollectionTier {
	return (COLLECTION_TIERS as readonly string[]).includes(v);
}
export function isCollectionCategory(v: string): v is CollectionCategory {
	return (COLLECTION_CATEGORIES as readonly string[]).includes(v);
}
