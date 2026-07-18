// Live post-load invariants for the unshaken ingestion (unshaken-ingest A1).
//   node --import tsx scripts/smoke-media.mjs
// Run AFTER the pipeline load; also re-run scripts/smoke-vocab.mjs after.
// Strongs lesson: assert CONTENT values, not just existence/counts.
// COR-5: numeric comes back as string from postgres.js — coerce and CHECK it.
// Exit 0 clean, 1 fatal, 2 invariant failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';
import { UNSHAKEN } from './ingest-podcast/shows/unshaken.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let sql;
try {
	const envPath = join(ROOT, '.env');
	if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
	const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	if (!url) throw new Error('DATABASE_URL not found in root .env');
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	sql = postgres(url, { prepare: false, max: 1 });
} catch (err) {
	console.error('FATAL:', scrubSecrets(err.message));
	process.exit(1);
}

let failures = 0;
function check(name, pass, detail = {}) {
	console.log(JSON.stringify({ event: 'invariant_check', name, pass, ...detail }));
	if (!pass) failures += 1;
}

try {
	const show = UNSHAKEN.id;

	// counts
	const [{ n: episodes }] = await sql`
    SELECT count(*)::int AS n FROM lumen.entities
    WHERE collection_id = ${show} AND entity_type = 'content_item'`;
	check('episodes_loaded', episodes === UNSHAKEN.episodeCount, { episodes, expected: UNSHAKEN.episodeCount });

	const [{ n: transcriptRows }] = await sql`
    SELECT count(*)::int AS n FROM lumen.transcripts t
    JOIN lumen.entities e ON e.id = t.episode_id WHERE e.collection_id = ${show}`;
	check('transcripts_present', transcriptRows > 1000, { rows: transcriptRows });

	const [{ n: orphanTranscripts }] = await sql`
    SELECT count(*)::int AS n FROM lumen.transcripts t
    LEFT JOIN lumen.entities e ON e.id = t.episode_id WHERE e.id IS NULL`;
	check('no_orphan_transcripts', orphanTranscripts === 0, { orphans: orphanTranscripts });

	const [{ n: edges }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges WHERE collection_id = ${show}`;
	const [{ n: dupes }] = await sql`
    SELECT count(*)::int AS n FROM (
      SELECT from_id, to_id, rel_type FROM lumen.edges
      WHERE collection_id = ${show}
      GROUP BY 1,2,3 HAVING count(*) > 1
    ) d`;
	check('edges_present_no_dupes', edges > 0 && dupes === 0, { edges, duplicate_tuples: dupes });

	const [{ n: searchRows }] = await sql`
    SELECT count(*)::int AS n FROM lumen.search_index WHERE collection_id = ${show}`;
	check('search_projections', searchRows === UNSHAKEN.episodeCount, { rows: searchRows });

	// REL-8: fail-safe until Phase B
	const [coll] = await sql`SELECT public FROM lumen.collections WHERE id = ${show}`;
	check('collection_public_false', coll?.public === false, { public: coll?.public });

	// every episode's edges resolve to real chapters (fail-closed anchoring)
	const [{ n: badAnchors }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges ed
    LEFT JOIN lumen.chapters c ON c.id = ed.to_id
    WHERE ed.collection_id = ${show} AND c.id IS NULL`;
	check('anchors_resolve_to_chapters', badAnchors === 0, { unresolved: badAnchors });

	// COR-5 + content VALUE canary: a 2 Kings deep dive that never says
	// "Elisha" is a wrong transcript, whatever the counts say. Also proves the
	// numeric→Number coercion pattern the app must use.
	const probeEpisode = `${show}-4pSrikfJ5Yw`;
	const [hit] = await sql`
    SELECT t_start_s, text FROM lumen.transcripts
    WHERE episode_id = ${probeEpisode} AND text ILIKE '%elisha%'
    ORDER BY seq LIMIT 1`;
	const coerced = hit ? Number(hit.t_start_s) : NaN;
	check('content_canary_elisha', Boolean(hit), { episode: probeEpisode });
	check('numeric_coerces_to_number', Number.isFinite(coerced) && typeof coerced === 'number', {
		raw_type: hit ? typeof hit.t_start_s : null,
		coerced,
	});

	// media descriptor completeness (Phase B render contract). COR-5 class:
	// the driver can return jsonb as a STRING — parse-if-string before use.
	const [ent] = await sql`
    SELECT metadata FROM lumen.entities WHERE id = ${probeEpisode}`;
	const meta =
		typeof ent?.metadata === 'string' ? JSON.parse(ent.metadata) : ent?.metadata;
	const media = meta?.media;
	check(
		'media_descriptor_complete',
		media?.kind === 'youtube' && media?.video_id === '4pSrikfJ5Yw' && Number(media?.duration_s) > 0,
		{ media },
	);
} catch (err) {
	console.error('FATAL: query failed:', scrubSecrets(err.message));
	await sql.end();
	process.exit(1);
}

await sql.end();
if (failures) {
	console.error(`\n${failures} media invariant(s) failed.`);
	process.exit(2);
}
console.log('\nmedia smoke clean.');
