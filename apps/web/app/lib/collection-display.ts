/**
 * Collection-first display registry (media-collections design, rule 1):
 * the COLLECTION decides where media appears; media.kind only decides how an
 * item renders once there. Keyed by collection id, values are named layout
 * families. FAIL-CLOSED: an unregistered collection is queryable but rendered
 * nowhere — no reader surface may select media by entity_type/media.kind
 * across collections. When community/personal collections arrive, `family`
 * promotes to a display_kind column and user collections pick from this set.
 */
export type DisplayFamily = "episodes" | "gallery";

const REGISTRY: Record<string, DisplayFamily> = {
	unshaken: "episodes",
	art: "gallery",
	// The Stick of Joseph (docs/design/stick-of-joseph.md) — five curated
	// collections, one show
	"soj-todd-mclauchlin": "episodes",
	"soj-andrea-woodmansee": "episodes",
	"soj-mike-dave-books": "episodes",
	"soj-stick-of-judah": "episodes",
	"soj-live-events": "episodes",
};

export function displayFamily(collectionId: string): DisplayFamily | null {
	return REGISTRY[collectionId] ?? null;
}
