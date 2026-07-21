// M4 (search-endpoint): artwork + strongs projections into lumen.search_index
// and the lumen.entity_degree boost table. Re-runnable: kind-scoped
// delete+rebuild per projection (BLA-3 ownership: this script owns
// kind='artwork' and kind='strongs'), full refresh for entity_degree.
// Run after art/strongs/phase-b data changes (DAT-9: refresh cadence rides
// the same runbook as build-search-moments).
//   node --import tsx scripts/migrate-search-projections.mjs            # dry-run
//   COMMIT=1 node --import tsx scripts/migrate-search-projections.mjs   # apply
// Exit 0 success/clean, 1 fatal, 2 invariant failure.
// Rollback: DELETE FROM lumen.search_index WHERE kind IN ('artwork','strongs');
// DROP TABLE lumen.entity_degree — only after the M5 worker deploy is rolled
// back (reverse-order rule; per-group degrade covers the gap meanwhile).
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrubSecrets } from './ingest-podcast/util.mjs';

export const DEGREE_DDL = `
CREATE TABLE IF NOT EXISTS lumen.entity_degree (
  entity_id text PRIMARY KEY,
  degree    int  NOT NULL CHECK (degree >= 0)
);
`;

// A2-lesson guard: some historic metadata rows were double-encoded jsonb
// strings; normalize before extracting (parse-if-string, server-side).
const META = `CASE WHEN jsonb_typeof(e.metadata) = 'string'
              THEN (e.metadata #>> '{}')::jsonb ELSE coalesce(e.metadata, '{}'::jsonb) END`;

const ARTWORK_INSERT = `
INSERT INTO lumen.search_index (kind, ref_id, collection_id, title, tsv, payload)
SELECT 'artwork', e.id, e.collection_id, e.name,
       setweight(to_tsvector('english', coalesce(e.name, '')), 'A')
    || setweight(to_tsvector('english', coalesce(m.meta->>'artist_name', '')), 'B')
    || setweight(to_tsvector('english',
         coalesce((SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(coalesce(m.meta->'scenes', '[]'::jsonb)) x), '') || ' '
      || coalesce((SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(coalesce(m.meta->'biblical_character', '[]'::jsonb)) x), '') || ' '
      || coalesce((SELECT string_agg(x, ' ') FROM jsonb_array_elements_text(coalesce(m.meta->'biblical_theme', '[]'::jsonb)) x), '')), 'C')
    || setweight(to_tsvector('english', coalesce(m.meta->>'medium', '')), 'D'),
       jsonb_build_object(
         'refs', coalesce(m.meta->'refs', '[]'::jsonb),
         'thumbnail_url', coalesce(m.meta->>'thumbnail_800_url', m.meta->>'image_url'),
         'artist_name', m.meta->>'artist_name',
         'year', m.meta->'year',
         'fame', coalesce((m.meta->>'fame')::numeric, 0))
FROM lumen.entities e
CROSS JOIN LATERAL (SELECT ${META} AS meta) m
WHERE e.entity_type = 'artwork';
`;

// Translit is accented (agapē) and dotted (ye.ho.vah): index unaccented AND
// dot-collapsed forms so 'agape' and 'yehovah' both hit (REL-4/COR-3).
const STRONGS_INSERT = `
INSERT INTO lumen.search_index (kind, ref_id, collection_id, title, tsv, payload)
SELECT 'strongs', s.strongs_no, 'strongs',
       coalesce(s.translit, s.strongs_no) || ' ' || coalesce(s.original, ''),
       setweight(to_tsvector('english',
         s.strongs_no || ' ' || coalesce(extensions.unaccent(s.translit), '') || ' '
         || replace(coalesce(extensions.unaccent(s.translit), ''), '.', '')), 'A')
    || setweight(to_tsvector('english', coalesce(s.gloss, '')), 'B')
    || setweight(to_tsvector('english', coalesce(s.definition, '')), 'C'),
       jsonb_build_object(
         'strongs_no', s.strongs_no, 'lang', s.lang, 'original', s.original,
         'translit', s.translit, 'gloss', s.gloss)
FROM lumen.strongs_lexicon s;
`;

const DEGREE_REFRESH = `
DELETE FROM lumen.entity_degree;
INSERT INTO lumen.entity_degree (entity_id, degree)
SELECT id, count(*)::int FROM (
  SELECT from_id AS id FROM lumen.edges
  UNION ALL
  SELECT to_id FROM lumen.edges
) x GROUP BY id;
`;

const INVARIANTS = [
	{
		name: 'artwork_projection_complete',
		sql: `SELECT (SELECT count(*) FROM lumen.search_index WHERE kind = 'artwork')
	        = (SELECT count(*) FROM lumen.entities WHERE entity_type = 'artwork') AS pass`,
	},
	{
		name: 'strongs_projection_complete',
		sql: `SELECT (SELECT count(*) FROM lumen.search_index WHERE kind = 'strongs')
	        = (SELECT count(*) FROM lumen.strongs_lexicon) AS pass`,
	},
	{
		name: 'projections_collection_stamped',
		sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index
	    WHERE kind IN ('artwork','strongs','moment') AND collection_id IS NULL`,
	},
	{
		name: 'artwork_scene_searchable_pentecost',
		sql: `SELECT EXISTS (SELECT 1 FROM lumen.search_index
	    WHERE kind = 'artwork' AND ref_id = 'art:met-471845'
	      AND tsv @@ websearch_to_tsquery('english', 'pentecost')) AS pass`,
	},
	{
		name: 'strongs_agape_reaches_G26',
		sql: `SELECT EXISTS (SELECT 1 FROM lumen.search_index
	    WHERE kind = 'strongs' AND ref_id = 'G26'
	      AND tsv @@ websearch_to_tsquery('english', 'agape')) AS pass`,
	},
	{
		name: 'strongs_H3068_present',
		sql: `SELECT EXISTS (SELECT 1 FROM lumen.search_index
	    WHERE kind = 'strongs' AND ref_id = 'H3068') AS pass`,
	},
	{
		name: 'artwork_orphan_free',
		sql: `SELECT count(*) = 0 AS pass FROM lumen.search_index si
	    WHERE si.kind = 'artwork'
	      AND NOT EXISTS (SELECT 1 FROM lumen.entities e WHERE e.id = si.ref_id)`,
	},
	{
		name: 'degree_populated_and_sane',
		sql: `SELECT (SELECT count(*) > 40000 FROM lumen.entity_degree)
	      AND (SELECT degree > 0 FROM lumen.entity_degree WHERE entity_id = 'melchizedek-1') AS pass`,
	},
	{
		name: 'lumen_read_can_select_degree',
		sql: `SELECT has_table_privilege('lumen_read', 'lumen.entity_degree', 'SELECT') AS pass`,
	},
	// moments_and_episodes_untouched is checked dynamically in main() against a
	// pre-tx baseline (DATC-1/CORC-6): literal counts false-fail on the
	// mandated post-ingest re-run, which changes those kinds by design.
];

async function main() {
	const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
	const commit = process.env.COMMIT === '1';
	const require = createRequire(import.meta.url);
	const postgres = require('postgres');
	const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
	const sql = postgres(url, { prepare: false, max: 1 });

	let baseline = [];
	try {
		// Prechecks: M1 unaccent + M2 artifacts exist (DAT-8 ordering).
		const pre = await sql`
			SELECT (SELECT to_regprocedure('extensions.unaccent(text)') IS NOT NULL) AS unaccent_ok,
			       (SELECT to_regclass('lumen.search_index') IS NOT NULL) AS search_index_ok`;
		console.log(JSON.stringify({ event: 'precheck', name: 'prerequisites', pass: pre[0].unaccent_ok && pre[0].search_index_ok }));
		if (!(pre[0].unaccent_ok && pre[0].search_index_ok)) {
			await sql.end();
			process.exit(2);
		}

		// Ownership baseline (BLA-3, mirrors M3's other_kinds_untouched): the
		// kinds this script does NOT own must be byte-identical in count after.
		baseline = await sql`
			SELECT kind, count(*)::int AS n FROM lumen.search_index
			WHERE kind NOT IN ('artwork', 'strongs') GROUP BY kind ORDER BY kind`;

		await sql.begin(async (tx) => {
			await tx.unsafe(DEGREE_DDL);
			await tx.unsafe(`DELETE FROM lumen.search_index WHERE kind = 'artwork'`);
			await tx.unsafe(ARTWORK_INSERT);
			await tx.unsafe(`DELETE FROM lumen.search_index WHERE kind = 'strongs'`);
			await tx.unsafe(STRONGS_INSERT);
			await tx.unsafe(DEGREE_REFRESH);
			const counts = await tx`
				SELECT (SELECT count(*)::int FROM lumen.search_index WHERE kind = 'artwork') AS artwork,
				       (SELECT count(*)::int FROM lumen.search_index WHERE kind = 'strongs') AS strongs,
				       (SELECT count(*)::int FROM lumen.entity_degree) AS degree_rows,
				       (SELECT max(degree)::int FROM lumen.entity_degree) AS max_degree`;
			console.log(JSON.stringify({ event: 'projection_counts', ...counts[0] }));
			if (!commit) throw new Error('DRY_RUN_ROLLBACK');
		});
		console.log(JSON.stringify({ event: 'migration_applied', commit: true }));
	} catch (err) {
		if (err.message === 'DRY_RUN_ROLLBACK') {
			console.log(JSON.stringify({ event: 'migration_dry_run_ok', commit: false }));
		} else {
			console.error('FATAL:', scrubSecrets(err.message));
			await sql.end();
			process.exit(1);
		}
	}

	if (commit) {
		await sql.unsafe(`VACUUM ANALYZE lumen.search_index`);
		await sql.unsafe(`VACUUM ANALYZE lumen.entity_degree`);
	}

	// Invariants run outside the tx (read-only) in BOTH modes (OBSC-8,
	// migrate-media-collections convention): post-commit they verify reality;
	// after a dry-run they report against the untouched database — report,
	// don't judge.
	let failures = 0;
	for (const inv of INVARIANTS) {
		try {
			const rows = await sql.unsafe(inv.sql);
			const pass = rows[0]?.pass === true;
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass }));
			if (!pass) failures += 1;
		} catch (err) {
			console.log(JSON.stringify({ event: 'invariant_check', name: inv.name, pass: false, error: scrubSecrets(err.message) }));
			failures += 1;
		}
	}

	// DATC-1/CORC-6: non-owned kinds compared against the pre-tx baseline —
	// count-shape agnostic, so post-ingest re-runs cannot false-fail.
	try {
		const after = await sql`
			SELECT kind, count(*)::int AS n FROM lumen.search_index
			WHERE kind NOT IN ('artwork', 'strongs') GROUP BY kind ORDER BY kind`;
		const beforeMap = Object.fromEntries(baseline.map((r) => [r.kind, r.n]));
		const afterMap = Object.fromEntries(after.map((r) => [r.kind, r.n]));
		const pass = JSON.stringify(beforeMap) === JSON.stringify(afterMap);
		console.log(JSON.stringify({ event: 'invariant_check', name: 'moments_and_episodes_untouched', pass, before: beforeMap, after: afterMap }));
		if (!pass) failures += 1;
	} catch (err) {
		console.log(JSON.stringify({ event: 'invariant_check', name: 'moments_and_episodes_untouched', pass: false, error: scrubSecrets(err.message) }));
		failures += 1;
	}

	await sql.end();
	if (commit && failures > 0) process.exit(2);
	console.log(JSON.stringify({ event: 'migration_done', commit, invariant_failures: failures }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
