// Stage 1 — discover (unshaken-ingest A1). Pure filter/validity logic here;
// the runner shells out to yt-dlp and writes episodes.json (CON-1: discover
// OWNS the enrichment transform — episodes.json carries the canonical shape
// consumed by every later stage).
import { parseTitle } from './parse-title.mjs';
import { assertVideoId } from './util.mjs';
import { expectedEpisodeCount, isExplicitShow } from './show-shape.mjs';

/** Newest-first raw upload list → the show's deep dives, capped at
 * config.episodeCount. Raw order is preserved (yt-dlp emits newest first). */
export function filterEpisodes(rawList, config) {
	return rawList
		.filter((r) => parseTitle(r.title) !== null)
		.slice(0, config.episodeCount);
}

/** H10: episodes.json skips discovery only when it parses, matches the
 * expected count, and every entry has a valid id + title. Explicit shows
 * additionally require every entry to carry its collectionId — an artifact
 * from before the multi-collection change must refetch, not half-load. */
export function isValidEpisodesArtifact(json, config) {
	if (!json || !Array.isArray(json.episodes)) return false;
	if (json.episodes.length !== expectedEpisodeCount(config)) return false;
	const explicit = isExplicitShow(config);
	return json.episodes.every((e) => {
		try {
			assertVideoId(e.id);
		} catch {
			return false;
		}
		if (explicit && typeof e.collectionId !== 'string') return false;
		return typeof e.title === 'string' && e.title.length > 0;
	});
}

/** Enrichment transform: raw entry → canonical episode record (CON-1). */
export function enrichEpisode(raw) {
	const parsed = parseTitle(raw.title);
	if (!parsed) throw new Error(`unparseable CFM title: ${JSON.stringify(raw.title)}`);
	return {
		id: assertVideoId(raw.id),
		title: raw.title,
		subtitle: parsed.subtitle,
		spans: parsed.spans,
		durationS: raw.duration ?? null,
		uploadDate: raw.upload_date ?? null,
	};
}

/** Explicit-show enrichment: verbatim title, no scripture block. The episode
 * carries its collection so every later stage knows where it belongs. */
export function enrichExplicitEpisode(raw, collectionId) {
	return {
		id: assertVideoId(raw.id),
		title: raw.title,
		subtitle: null,
		spans: null,
		durationS: raw.duration ?? null,
		uploadDate: raw.upload_date ?? null,
		collectionId,
	};
}
