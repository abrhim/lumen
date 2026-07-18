// Live post-load invariants for the A2 extraction (unshaken-extraction).
//   node --import tsx scripts/smoke-extraction.mjs
// Run AFTER --stage=load-extraction. Strongs lesson: assert CONTENT, not
// just counts. Exit 0 clean, 1 fatal, 2 invariant failure.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOW = 'unshaken';

let sql;
try {
	const envPath = join(ROOT, '.env');
	if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
	const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	if (!url) throw new Error('DATABASE_URL not found in root .env');
	const require = createRequire(import.meta.url);
	sql = require('postgres')(url, { prepare: false, max: 1 });
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
	// PW-A5 presence canary: every episode with transcripts HAS extraction
	// edges — catches any silent-wipe path after the fact.
	const noExtraction = await sql`
    SELECT e.id FROM lumen.entities e
    WHERE e.collection_id = ${SHOW} AND e.entity_type = 'content_item'
      AND EXISTS (SELECT 1 FROM lumen.transcripts t WHERE t.episode_id = e.id)
      AND NOT EXISTS (
        SELECT 1 FROM lumen.edges ed
        WHERE ed.from_id = e.id AND ed.source = 'unshaken-extraction')`;
	check('every_transcribed_episode_has_extraction_edges', noExtraction.length === 0, {
		missing: noExtraction.map((r) => r.id),
	});

	// PW-A1 reset canary: chapter (title) edges of extracted episodes carry
	// non-empty mentions.
	const [{ n: emptyChapterMentions }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges ed
    WHERE ed.collection_id = ${SHOW} AND ed.source = 'unshaken-youtube'
      AND jsonb_array_length(ed.metadata->'mentions') = 0
      AND EXISTS (
        SELECT 1 FROM lumen.edges x
        WHERE x.from_id = ed.from_id AND x.source = 'unshaken-extraction')`;
	check('title_edges_have_mentions_after_extraction', Number(emptyChapterMentions) === 0, {
		empty: Number(emptyChapterMentions),
	});

	// typeof invariant, edges AND entities (PW-A3)
	const [{ n: stringMeta }] = await sql`
    SELECT (SELECT count(*)::int FROM lumen.edges
            WHERE collection_id = ${SHOW} AND jsonb_typeof(metadata) = 'string')
         + (SELECT count(*)::int FROM lumen.entities
            WHERE collection_id = ${SHOW} AND jsonb_typeof(metadata) = 'string') AS n`;
	check('metadata_jsonb_is_object', Number(stringMeta) === 0, { string_typed: Number(stringMeta) });

	// F7 full form: KIND-AWARE target resolution (edges have no FKs — this is
	// the only orphan detector). rel_type decides the target table.
	const [{ n: orphanVerses }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges ed
    LEFT JOIN lumen.verses v ON v.id = ed.to_id
    WHERE ed.collection_id = ${SHOW} AND ed.source = 'unshaken-extraction'
      AND ed.rel_type = 'DISCUSSES' AND ed.to_id LIKE '%-%-%-%' AND v.id IS NULL`;
	check('verse_targets_resolve', Number(orphanVerses) === 0, { orphans: Number(orphanVerses) });
	const [{ n: orphanEntities }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges ed
    LEFT JOIN lumen.entities e ON e.id = ed.to_id
    WHERE ed.collection_id = ${SHOW} AND ed.source = 'unshaken-extraction'
      AND ed.rel_type IN ('MENTIONS','TEACHES') AND e.id IS NULL`;
	check('entity_targets_resolve', Number(orphanEntities) === 0, { orphans: Number(orphanEntities) });

	// no dup pairs (partial-index presence detector)
	const [{ n: dupes }] = await sql`
    SELECT count(*)::int AS n FROM (
      SELECT from_id, to_id, rel_type FROM lumen.edges
      WHERE collection_id = ${SHOW} GROUP BY 1,2,3 HAVING count(*) > 1) d`;
	check('no_duplicate_pairs', Number(dupes) === 0, { dupes: Number(dupes) });

	// mentions content: sorted by t, confidence within [floor, 1]
	const badMentions = await sql`
    SELECT ed.from_id, ed.to_id FROM lumen.edges ed,
      LATERAL (
        SELECT bool_and((m->>'confidence')::numeric BETWEEN 0.5 AND 1) AS conf_ok,
               bool_and((m->>'t')::numeric >= COALESCE(lag((m->>'t')::numeric) OVER (), 0)) AS sorted_ok
        FROM jsonb_array_elements(ed.metadata->'mentions') m) chk
    WHERE ed.collection_id = ${SHOW} AND ed.source = 'unshaken-extraction'
      AND (NOT chk.conf_ok OR NOT chk.sorted_ok) LIMIT 5`;
	check('mentions_sorted_and_floored', badMentions.length === 0, {
		bad: badMentions.map((r) => `${r.from_id}→${r.to_id}`),
	});

	// title edges retain their confidence-1 anchor
	const [{ n: badTitle }] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = ${SHOW} AND source = 'unshaken-youtube'
      AND (metadata->>'confidence')::numeric != 1`;
	check('title_edges_keep_confidence_1', Number(badTitle) === 0, { bad: Number(badTitle) });

	// per-kind counts (content visibility, not a gate)
	const counts = await sql`
    SELECT rel_type, count(*)::int AS edges,
           sum(jsonb_array_length(metadata->'mentions'))::int AS mentions
    FROM lumen.edges
    WHERE collection_id = ${SHOW} AND source = 'unshaken-extraction'
    GROUP BY rel_type ORDER BY rel_type`;
	console.log(JSON.stringify({ event: 'extraction_counts', counts }));
} catch (err) {
	console.error('FATAL: query failed:', scrubSecrets(err.message));
	await sql.end();
	process.exit(1);
}

await sql.end();
if (failures) {
	console.error(`\n${failures} extraction invariant(s) failed.`);
	process.exit(2);
}
console.log('\nextraction smoke clean.');
