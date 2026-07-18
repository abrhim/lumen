// Extraction load-plan builder + executor (unshaken-extraction A2).
// Source-column scoping throughout (panel F4); title edges are the ONLY
// update candidates (PW-A2); repair preflight opens every plan (PW-A3).

// PW-A2: exported + harness-pinned. Only title-sourced rows may classify as
// UPDATE candidates — extraction-sourced pairs must always re-INSERT after
// the scoped delete, or run 2 silently destroys run 1.
export const EXISTING_EDGES_SQL = `
SELECT from_id, to_id, rel_type, source, metadata
FROM lumen.edges
WHERE from_id = $1 AND collection_id = $2 AND source = 'unshaken-youtube'`;

/** Semantic statement plan for one episode. Executor renders SQL and runs
 * everything in ONE tx with SET LOCAL guards. */
export function buildExtractionLoadPlan({ episodeId, collectionId, edges, existingEdges = [] }) {
	for (const e of edges) {
		if (e.__trap) {
			throw new Error(
				'trap object reached the load plan — the eval sample must never enter the load path',
			);
		}
	}
	const titlePairs = new Map();
	for (const row of existingEdges) {
		if (row.source !== 'unshaken-youtube') continue;
		titlePairs.set(`${row.to_id}|${row.rel_type}`, row);
	}
	const statements = [
		{ kind: 'assert-metadata-repaired', collectionId },
		{
			kind: 'delete-extraction-edges',
			episodeId,
			collectionId,
			sourceFilter: 'unshaken-extraction',
		},
	];
	const summary = { episode: episodeId, updates: 0, inserts: 0, mentionCount: 0 };
	for (const e of edges) {
		const mentions = [...(e.mentions ?? [])].sort((a, b) => a.t - b.t);
		summary.mentionCount += mentions.length;
		if (titlePairs.has(`${e.toId}|${e.relType}`)) {
			// PW-A4: whole-object metadata, mentions REPLACED with exactly the
			// fresh set; confidence-1 anchor and source column untouched.
			statements.push({
				kind: 'update-title-edge',
				episodeId,
				collectionId,
				toId: e.toId,
				relType: e.relType,
				source: 'unshaken-youtube',
				metadata: { source: 'title', confidence: 1, mentions },
			});
			summary.updates += 1;
		} else {
			const confidence = mentions.reduce((max, m) => Math.max(max, m.confidence ?? 0), 0);
			statements.push({
				kind: 'insert-edge',
				episodeId,
				collectionId,
				toId: e.toId,
				relType: e.relType,
				source: 'unshaken-extraction',
				metadata: { source: 'extraction', confidence, mentions },
			});
			summary.inserts += 1;
		}
	}
	return { statements, summary };
}

/** Execute one episode's plan in a single tx. `sql` is a postgres.js
 * instance; values pass RAW (objects included) — postgres.js serializes
 * jsonb exactly once (F1-regression: the A1 pre-stringify bug class). */
export async function executeExtractionLoadPlan(sql, plan, { log = () => {} } = {}) {
	await sql.begin(async (tx) => {
		await tx.unsafe("SET LOCAL statement_timeout = '60s'");
		await tx.unsafe("SET LOCAL idle_in_transaction_session_timeout = '60s'");
		for (const s of plan.statements) {
			if (s.kind === 'assert-metadata-repaired') {
				const rows = await tx`
					SELECT (SELECT count(*)::int FROM lumen.edges
					        WHERE collection_id = ${s.collectionId}
					          AND jsonb_typeof(metadata) = 'string')
					     + (SELECT count(*)::int FROM lumen.entities
					        WHERE collection_id = ${s.collectionId}
					          AND jsonb_typeof(metadata) = 'string') AS n`;
				const n = Number(rows[0].n);
				if (n > 0) {
					throw new Error(
						`unrepaired metadata: ${n} string-typed rows — run repair-metadata-encoding first`,
					);
				}
			} else if (s.kind === 'delete-extraction-edges') {
				await tx`
					DELETE FROM lumen.edges
					WHERE from_id = ${s.episodeId}
					  AND collection_id = ${s.collectionId}
					  AND source = ${s.sourceFilter}`;
			} else if (s.kind === 'update-title-edge') {
				const result = await tx`
					UPDATE lumen.edges
					SET metadata = ${sql.json(s.metadata)}
					WHERE from_id = ${s.episodeId}
					  AND to_id = ${s.toId}
					  AND rel_type = ${s.relType}
					  AND collection_id = ${s.collectionId}
					  AND source = ${s.source}`;
				// PW-A2: a misclassified update must abort the episode loudly,
				// never silently touch 0 rows.
				if (result.count !== 1) {
					throw new Error(
						`title-edge update touched ${result.count} rows for ${s.toId} ${s.relType} — expected exactly 1`,
					);
				}
			} else if (s.kind === 'insert-edge') {
				await tx`
					INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, source, metadata)
					VALUES (${s.episodeId}, ${s.toId}, ${s.relType}, ${s.collectionId}, ${s.source}, ${sql.json(s.metadata)})`;
			} else {
				throw new Error(`unknown statement kind: ${s.kind}`);
			}
		}
	});
	log('extraction_load_done', plan.summary);
	return plan.summary;
}
