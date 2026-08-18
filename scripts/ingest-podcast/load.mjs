// Stage 5 — load (unshaken-ingest A1; second-show generalization 2026-08-18).
// buildLoadPlan is PURE and deterministic: it emits parameterized statement
// descriptors {text, values} plus a summary; the runner executes them in ONE
// transaction per episode. Untrusted text (titles, transcript) travels ONLY
// in values (H2). Order contract (H4): every DELETE precedes the first
// INSERT; the explicit edges delete exists because lumen.edges has no
// PK/cascade (COR-1).
//
// Second-show rules (docs/design/second-show.md):
//  - the episode's COLLECTION (not the show) owns collection_id and the
//    source strings: `${collectionId}-youtube` / `${collectionId}-extraction`.
//    Unshaken's collection id equals its show id, so existing rows already
//    match — zero data migration.
//  - ON CONFLICT arbitrates on idx_edges_unique (from,to,rel,collection),
//    the general index — the per-show partial is retired with this change.
//  - verbatim-title episodes carry spans:null and subtitle:null — no chapter
//    anchors, no block label, and every tsvector part is COALESCEd (a null
//    part nulls the whole concatenation and the row becomes unsearchable).
import { collectionForEpisode, assertSafeCollectionId } from './show-shape.mjs';

/** B3: search block-label — whole-book spans render the BOOK NAME (never
 * "Joshua 1"); singles "Book N"; ranges "Book A-B". Null spans (verbatim
 * shows) have no block and no label. */
function blockLabel(spans) {
	if (!spans) return null;
	return spans
		.map((s) => {
			// open-end: whole book when starting at 1; "Book N+" keeps the start
			// chapter visible for cross-book tails (fix-verification residual R2)
			if (s.end === null || s.end === undefined) {
				return s.start > 1 ? `${s.book} ${s.start}+` : s.book;
			}
			if (s.end === s.start) return `${s.book} ${s.start}`;
			return `${s.book} ${s.start}-${s.end}`;
		})
		.join(' · ');
}

/** episode: {videoId,title,subtitle,spans,uploadDate,durationS,collectionId?}
 *  transcriptRows: utterancesToRows output · chapterIds: anchorsForBlock
 *  show: shows/*.mjs config. The episode's collection derives from
 *  episode.collectionId (explicit shows) or the show's single collection. */
export function buildLoadPlan(episode, transcriptRows, chapterIds, show) {
	const episodeId = `${show.id}-${episode.videoId}`;
	const collection = collectionForEpisode(show, episode);
	const cid = assertSafeCollectionId(collection.id);
	const sourceYoutube = `${cid}-youtube`;
	const statements = [];

	// ── deletes first (idempotent re-run; entity delete cascades transcripts) ──
	statements.push({
		text: 'DELETE FROM lumen.entities WHERE id = $1',
		values: [episodeId],
	});
	// PW-A1: STALE ANCHORS ONLY — a blanket delete would wipe A2 extraction
	// edges, and deleting title edges first would defeat the mentions-
	// preserving ON CONFLICT below (the conflict row would already be gone).
	statements.push({
		text: `DELETE FROM lumen.edges
WHERE from_id = $1 AND collection_id = $2
  AND source = $3 AND to_id != ALL($4)`,
		values: [episodeId, cid, sourceYoutube, chapterIds],
	});
	statements.push({
		text: "DELETE FROM lumen.search_index WHERE kind = 'episode' AND ref_id = $1",
		values: [episodeId],
	});

	// ── collection upsert. B2: INSERT seeds public=false on FIRST ingest;
	// ON CONFLICT deliberately never touches public — Phase B's flip to true
	// must survive every weekly re-run. ──
	statements.push({
		text: `INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage, public)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
  tier = EXCLUDED.tier, category = EXCLUDED.category, provenance = EXCLUDED.provenance,
  license = EXCLUDED.license, storage = EXCLUDED.storage`,
		values: [
			cid,
			collection.name,
			collection.description,
			collection.tier,
			collection.category,
			collection.provenance,
			collection.license,
			collection.storage,
			// seed value is the show's call (Abram 2026-08-18: SoJ launches
			// public); ON CONFLICT still never touches it, so a manual flip in
			// EITHER direction survives every re-run — B2 intact
			collection.public ?? false,
		],
	});

	// ── episode entity (media descriptor per design doc). COALESCE both
	// weighted parts: a null subtitle otherwise nulls the ENTIRE vector and
	// the episode vanishes from search. ──
	statements.push({
		text: `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
VALUES ($1, 'content_item', $2, $3, $4::jsonb, $5, $6,
  setweight(to_tsvector('english', COALESCE($2, '')), 'A') || setweight(to_tsvector('english', COALESCE($3, '')), 'B'))`,
		values: [
			episodeId,
			episode.title,
			episode.subtitle,
			{
				media: {
					kind: 'youtube',
					video_id: episode.videoId,
					duration_s: episode.durationS,
				},
				upload_date: episode.uploadDate,
				spans: episode.spans,
			},
			sourceYoutube,
			cid,
		],
	});

	// ── transcript rows: BATCHED multi-row inserts (run-1 lesson: 6,030
	// per-row statements in one tx stalled 12min through the pooler; 500-row
	// chunks = ~13 statements, 3,000 params each, far under pg's 65,535) ──
	const CHUNK = 500;
	for (let i = 0; i < transcriptRows.length; i += CHUNK) {
		const chunk = transcriptRows.slice(i, i + CHUNK);
		const values = [];
		const tuples = chunk.map((r, j) => {
			const b = j * 6;
			values.push(episodeId, r.seq, r.t_start_s, r.t_end_s, r.speaker, r.text);
			return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
		});
		statements.push({
			text: `INSERT INTO lumen.transcripts (episode_id, seq, t_start_s, t_end_s, speaker, text)
VALUES ${tuples.join(', ')}`,
			values,
		});
	}

	// ── DISCUSSES edges: one batched insert; mentions EMPTY until A2.
	// Verbatim shows anchor no chapters, so this loop simply never runs. ──
	for (let i = 0; i < chapterIds.length; i += CHUNK) {
		const chunk = chapterIds.slice(i, i + CHUNK);
		const values = [];
		const tuples = chunk.map((chapterId, j) => {
			const b = j * 5;
			values.push(
				episodeId,
				chapterId,
				cid,
				{ source: 'title', confidence: 1, mentions: [] },
				sourceYoutube,
			);
			return `($${b + 1}, $${b + 2}, 'DISCUSSES', $${b + 3}, $${b + 4}::jsonb, $${b + 5})`;
		});
		// PW-A1: UPSERT-ONLY, arbitrated on idx_edges_unique (the four-column
		// general index — second-show change; the unshaken partial is retired).
		// DO UPDATE preserves A2-written mentions (object-guarded: pre-repair
		// string rows must not poison the merge) instead of resetting them to
		// [] weekly. cid is regex-guarded above, so the interpolation is safe —
		// same posture the show.id interpolation always had.
		statements.push({
			text: `INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
VALUES ${tuples.join(', ')}
ON CONFLICT (from_id, to_id, rel_type, collection_id)
DO UPDATE SET source = '${sourceYoutube}', metadata = jsonb_build_object(
  'source', 'title', 'confidence', 1,
  'mentions', COALESCE(
    CASE WHEN jsonb_typeof(lumen.edges.metadata) = 'object'
         THEN lumen.edges.metadata->'mentions' END,
    '[]'::jsonb))`,
			values,
		});
	}

	// ── search projection: title(A) > subtitle(B) > block label(C) — H8.
	// Every part COALESCEd: verbatim shows have null subtitle AND null block. ──
	statements.push({
		text: `INSERT INTO lumen.search_index (kind, ref_id, collection_id, title, tsv, payload)
VALUES ('episode', $1, $2, $3,
  setweight(to_tsvector('english', COALESCE($3, '')), 'A') ||
  setweight(to_tsvector('english', COALESCE($4, '')), 'B') ||
  setweight(to_tsvector('english', COALESCE($5, '')), 'C'),
  $6::jsonb)`,
		values: [
			episodeId,
			cid,
			episode.title,
			episode.subtitle,
			blockLabel(episode.spans),
			{ episode: episodeId },
		],
	});

	return {
		episodeId,
		statements,
		summary: {
			entities: 1,
			transcripts: transcriptRows.length,
			edges: chapterIds.length,
			search: 1,
		},
	};
}
