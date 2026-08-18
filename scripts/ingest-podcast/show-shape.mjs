// Show-config shape helpers (second-show support, docs/design/second-show.md).
//
// Two config generations coexist:
//   unshaken.mjs  — ONE collection, channel-scan discovery, CFM titles
//   stick-of-joseph.mjs — FIVE collections with explicit episode ID lists,
//                         verbatim titles
// Everything downstream works off the normalized accessors here rather than
// branching on config shape at each call site.

/** Every collection the show ingests into, defaults folded in. Single-
 * collection shows normalize to one entry whose id IS the show id (that is
 * what Unshaken's edges/entities already carry as collection_id). */
export function collectionsOf(show) {
	if (Array.isArray(show.collections)) {
		return show.collections.map((c) => ({ ...(show.collectionDefaults ?? {}), ...c }));
	}
	return [{ id: show.id, episodes: null, ...show.collection }];
}

/** Explicit shows enumerate their episodes in the config; scan shows discover
 * them from the channel. */
export function isExplicitShow(show) {
	return Array.isArray(show.collections) && show.collections.every((c) => Array.isArray(c.episodes));
}

/** 'cfm' parses "Come Follow Me - <block>" titles into spans; 'verbatim'
 * keeps the title whole and carries no scripture block (spans null). */
export function titleParseMode(show) {
	return show.titleParse ?? 'cfm';
}

/** videoId -> collection config. Empty for scan shows. */
export function episodeCollectionMap(show) {
	const map = new Map();
	if (!isExplicitShow(show)) return map;
	for (const c of collectionsOf(show)) {
		for (const id of c.episodes) {
			if (map.has(id)) {
				throw new Error(`episode ${id} listed in two collections: ${map.get(id).id} and ${c.id}`);
			}
			map.set(id, c);
		}
	}
	return map;
}

/** The collection one episode belongs to. Scan-show episodes carry no
 * collectionId and resolve to the show's single collection. */
export function collectionForEpisode(show, episode) {
	const cols = collectionsOf(show);
	if (!episode.collectionId) return cols[0];
	const found = cols.find((c) => c.id === episode.collectionId);
	if (!found) throw new Error(`episode ${episode.id ?? episode.videoId} names unknown collection ${episode.collectionId}`);
	return found;
}

/** Discovery must find exactly this many episodes. */
export function expectedEpisodeCount(show) {
	if (isExplicitShow(show)) {
		return collectionsOf(show).reduce((n, c) => n + c.episodes.length, 0);
	}
	return show.episodeCount;
}

/** The interpolation guard load.mjs has always applied to show.id, now needed
 * for every collection id that reaches an ON CONFLICT or source string. */
export function assertSafeCollectionId(id) {
	if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`unsafe collection id: ${id}`);
	return id;
}
