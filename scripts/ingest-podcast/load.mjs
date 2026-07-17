// Stage 5 — load (unshaken-ingest A1). buildLoadPlan is PURE and
// deterministic: it emits parameterized statement descriptors {text, values}
// plus a summary; the runner executes them in ONE transaction per episode.
// Untrusted text (titles, transcript) travels ONLY in values (H2).
// Order contract (H4): every DELETE precedes the first INSERT; the explicit
// edges delete exists because lumen.edges has no PK/cascade (COR-1).

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

	// ── collection upsert (public=false until Phase B flips it — REL-8) ──
	statements.push({
		text: `INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage, public)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
  tier = EXCLUDED.tier, category = EXCLUDED.category, provenance = EXCLUDED.provenance,
  license = EXCLUDED.license, storage = EXCLUDED.storage, public = EXCLUDED.public`,
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

	// ── transcript rows ──
	for (const r of transcriptRows) {
		statements.push({
			text: `INSERT INTO lumen.transcripts (episode_id, seq, t_start_s, t_end_s, speaker, text)
VALUES ($1, $2, $3, $4, $5, $6)`,
			values: [episodeId, r.seq, r.t_start_s, r.t_end_s, r.speaker, r.text],
		});
	}

	// ── DISCUSSES edges: one per chapter; mentions EMPTY until A2 ──
	for (const chapterId of chapterIds) {
		statements.push({
			text: `INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
VALUES ($1, $2, 'DISCUSSES', $3, $4::jsonb, $5)`,
			values: [
				episodeId,
				chapterId,
				show.id,
				{ source: 'title', confidence: 1, mentions: [] },
				'unshaken-youtube',
			],
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
			episode.spans.map((s) => `${s.book} ${s.start}${s.end && s.end !== s.start ? `-${s.end}` : ''}`).join(' · '),
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
