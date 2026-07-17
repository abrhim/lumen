// Stage 5 — load (unshaken-ingest A1). buildLoadPlan is PURE and
// deterministic: it emits parameterized statement descriptors {text, values}
// plus a summary; the runner executes them in ONE transaction per episode.
// Untrusted text (titles, transcript) travels ONLY in values (H2).
// Order contract (H4): every DELETE precedes the first INSERT; the explicit
// edges delete exists because lumen.edges has no PK/cascade (COR-1).

/** B3: search block-label — whole-book spans render the BOOK NAME (never
 * "Joshua 1"); singles "Book N"; ranges "Book A-B". */
function blockLabel(spans) {
	return spans
		.map((s) => {
			if (s.end === null || s.end === undefined) return s.book;
			if (s.end === s.start) return `${s.book} ${s.start}`;
			return `${s.book} ${s.start}-${s.end}`;
		})
		.join(' · ');
}

/** episode: {videoId,title,subtitle,spans,uploadDate,durationS}
 *  transcriptRows: utterancesToRows output · chapterIds: anchorsForBlock
 *  show: shows/*.mjs config. */
export function buildLoadPlan(episode, transcriptRows, chapterIds, show) {
	const episodeId = `${show.id}-${episode.videoId}`;
	const statements = [];

	// ── deletes first (idempotent re-run; entity delete cascades transcripts) ──
	statements.push({
		text: 'DELETE FROM lumen.entities WHERE id = $1',
		values: [episodeId],
	});
	statements.push({
		text: 'DELETE FROM lumen.edges WHERE from_id = $1 AND collection_id = $2',
		values: [episodeId, show.id],
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
			show.id,
			show.collection.name,
			show.collection.description,
			show.collection.tier,
			show.collection.category,
			show.collection.provenance,
			show.collection.license,
			show.collection.storage,
			false,
		],
	});

	// ── episode entity (media descriptor per design doc) ──
	statements.push({
		text: `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
VALUES ($1, 'content_item', $2, $3, $4::jsonb, $5, $6,
  setweight(to_tsvector('english', $2), 'A') || setweight(to_tsvector('english', $3), 'B'))`,
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
			'unshaken-youtube',
			show.id,
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

	// ── DISCUSSES edges: one batched insert; mentions EMPTY until A2 ──
	for (let i = 0; i < chapterIds.length; i += CHUNK) {
		const chunk = chapterIds.slice(i, i + CHUNK);
		const values = [];
		const tuples = chunk.map((chapterId, j) => {
			const b = j * 5;
			values.push(
				episodeId,
				chapterId,
				show.id,
				{ source: 'title', confidence: 1, mentions: [] },
				'unshaken-youtube',
			);
			return `($${b + 1}, $${b + 2}, 'DISCUSSES', $${b + 3}, $${b + 4}::jsonb, $${b + 5})`;
		});
		statements.push({
			text: `INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
VALUES ${tuples.join(', ')}`,
			values,
		});
	}

	// ── search projection: title(A) > subtitle(B) > block label(C) — H8 ──
	statements.push({
		text: `INSERT INTO lumen.search_index (kind, ref_id, collection_id, title, tsv, payload)
VALUES ('episode', $1, $2, $3,
  setweight(to_tsvector('english', $3), 'A') ||
  setweight(to_tsvector('english', $4), 'B') ||
  setweight(to_tsvector('english', $5), 'C'),
  $6::jsonb)`,
		values: [
			episodeId,
			show.id,
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
