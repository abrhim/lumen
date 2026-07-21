// Data stress test (design: docs/ops/data-stress-test-design.md).
//   node --import tsx scripts/stress-test-data.mjs --phase=integrity|load|all
// STRICTLY READ-ONLY: sessions open read-only; every SQL string is asserted
// write-verb-free before execution. Results: docs/ops/stress-<date>/.
// Exit 0 all pass (baseline-debt allowed), 2 failures, 1 fatal.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { scrubSecrets } from './ingest-podcast/util.mjs';
import {
	ENTITY_TYPES,
	PG_REL_TYPES,
} from '../packages/scripture/src/vocab.ts';
import * as drizzleSchema from '../packages/scripture/src/schema.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'ops', 'stress-2026-07-18');
const KNOWN_SOURCES = ['unshaken-youtube', 'unshaken-extraction'];

// drizzle-orm lives in packages/scripture's dependency tree (pnpm: not hoisted
// to the root) — resolve the same copy schema.ts uses. Its table helpers are
// Symbol.for-keyed, so the CJS build interoperates with tsx's ESM load.
const scriptureRequire = createRequire(join(ROOT, 'packages/scripture/package.json'));
const { getTableName, getTableColumns, is: isDrizzleTable, Table: DrizzleTable } =
	scriptureRequire('drizzle-orm');

// ── read-only discipline ────────────────────────────────────────────────────

const WRITE_VERBS = /\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT|REVOKE|COPY|VACUUM|MERGE)\b/i;
function assertReadOnly(text) {
	if (WRITE_VERBS.test(text)) throw new Error(`write verb in stress SQL: ${text.slice(0, 80)}`);
	return text;
}

async function q(sql, text, params = []) {
	return sql.unsafe(assertReadOnly(text), params);
}

// ── pure SQL builders (exported for the harness tests — every fix carries
// a test, Abram 2026-07-18) ─────────────────────────────────────────────────

// Run-2 fix: `LIKE '%__trap%'` treats __ as two wildcards and matched 233
// transcript quotes containing the word "trap" (strpos exact count: 0).
export const TRAP_FIELD_PROBE_SQL = `
SELECT count(*)::int n FROM lumen.edges
WHERE strpos(metadata::text, '__trap') > 0
   OR strpos(metadata::text, 'originalTarget') > 0
   OR strpos(metadata::text, 'swappedTarget') > 0`;

// Run-2 fix: chr(0) in a pattern is a PG error ("null character not
// permitted") — and PG text FORBIDS NUL by construction, so the probe was
// both broken and unnecessary. Remaining probes: replacement chars,
// double-encoded entities, pathological lengths.
export function encodingSweepSQL(table, col) {
	return `
		SELECT count(*) FILTER (WHERE ${col} LIKE '%' || chr(65533) || '%')::int repl,
		       count(*) FILTER (WHERE ${col} LIKE '%&amp;%')::int dblenc,
		       count(*) FILTER (WHERE length(${col}) > 100000)::int huge
		FROM lumen.${table} WHERE ${col} IS NOT NULL`;
}

// Run-1 fix: metadata columns are DISCOVERED, never assumed (collections
// has no metadata column — the hardcoded list FATAL'd the first run).
export const META_TABLES_SQL = `
SELECT table_name FROM information_schema.columns
WHERE table_schema = 'lumen' AND column_name = 'metadata'`;

// Run-3 fix: JST dangling links split by PATTERN — verse numbers beyond the
// chapter's canonical end are Joseph Smith ADDITIONS (verified 427/427 on
// 2026-07-18), a data-model gap, not corruption. Anything else dangling is
// real corruption and fails.
export const JST_DANGLING_SPLIT_SQL = `
WITH dangling AS (
  SELECT e.metadata->>'verse_id' vid,
         (e.metadata ? 'anchor_verse_id'
          AND e.metadata->>'placement' = 'beyond_canon_end') AS anchored
  FROM lumen.entities e
  LEFT JOIN lumen.verses v ON v.id = e.metadata->>'verse_id'
  WHERE e.collection_id = 'jst' AND v.id IS NULL),
parsed AS (
  SELECT vid, anchored, regexp_replace(vid, '-[0-9]+$', '') chap,
         (regexp_match(vid, '-([0-9]+)$'))[1]::int vnum FROM dangling),
chapmax AS (
  SELECT chapter_id, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx
  FROM lumen.verses GROUP BY 1)
SELECT count(*)::int total,
       count(*) FILTER (WHERE cm.mx IS NOT NULL AND p.vnum > cm.mx)::int additions,
       count(*) FILTER (WHERE cm.mx IS NOT NULL AND p.vnum > cm.mx AND NOT p.anchored)::int unanchored,
       count(*) FILTER (WHERE cm.mx IS NULL OR p.vnum <= cm.mx)::int corrupt
FROM parsed p LEFT JOIN chapmax cm ON cm.chapter_id = p.chap`;

// Run-3 fix: Strong's numbers legitimately carry disambiguation suffixes —
// probed depth reaches F (H5526F), not just A/B (1,164 + 22 rows total).
export const STRONGS_NO_PATTERN = '^[HG][0-9]+[A-F]?$';

// ── scheduled-sweep probes (remediation v2 items 2/N2 · 1-pins · 3-pin · 6 ·
// 7 · D4, 2026-07-21). All read-only; pins for not-yet-run fixes land as
// baseline-debt and flip to hard passes as each fix ships. ──────────────────

// v2 item 1 pin: per-volume DIRECTIONAL verse parity (today's I9 checks
// global label totals only — post-sync those could flip green while
// per-volume parity went unverified). Graph LM_Verse ids page via the stable
// ORDER BY id SKIP/LIMIT pattern; volume attribution happens LOCALLY from PG
// books (verse id prefix = book id — longest match wins, so
// 'joseph-smith-history-…' can never land on a shorter sibling prefix).
export const GRAPH_VERSE_PAGE = 10000;
export function graphVersePageCypher(skip, limit = GRAPH_VERSE_PAGE) {
	if (!Number.isInteger(skip) || skip < 0 || !Number.isInteger(limit) || limit <= 0) {
		throw new Error(`invalid paging: skip=${skip} limit=${limit}`);
	}
	return `MATCH (v:LM_Verse) RETURN v.id AS id ORDER BY id SKIP ${skip} LIMIT ${limit}`;
}

/** Map verse ids to volumes via PG books ({id, volume_id}); every volume is
 * seeded at 0 so per-volume detail always shows the full picture. Ids that
 * match no `${book.id}-` prefix land in `unknown` (a bare book id is NOT a
 * verse). Pure — pinned in the harness tests. */
export function mapVerseIdsToVolumes(ids, books) {
	const prefixes = books
		.map((b) => ({ prefix: `${b.id}-`, volume: b.volume_id }))
		.sort((a, b) => b.prefix.length - a.prefix.length);
	const byVolume = {};
	for (const b of books) byVolume[b.volume_id] ??= 0;
	const unknown = [];
	for (const id of ids) {
		const hit = prefixes.find((p) => id.startsWith(p.prefix));
		if (hit) byVolume[hit.volume] += 1;
		else unknown.push(id);
	}
	return { byVolume, unknown };
}

/** Directional set difference — BOTH directions reported, never netted
 * (equal counts of missing and extra must not read as parity). */
export function diffIdSets(pgIds, graphIds) {
	const pgSet = new Set(pgIds);
	const graphSet = new Set(graphIds);
	return {
		pgOnly: [...pgSet].filter((id) => !graphSet.has(id)),
		graphOnly: [...graphSet].filter((id) => !pgSet.has(id)),
	};
}

// v2 item 1 pin: consumer two-hop path count from dc-76-22 (exact Cypher from
// the 2026-07-20 probe round). Pre-sync pinned state: node absent, 0 paths.
export const TWO_HOP_DC_76_22_CYPHER = `MATCH (v:LM_Verse {id: 'dc-76-22'})-[r1]-(x)-[r2]-(y)
    RETURN count(*) AS paths`;

// v2 item 3 pin: dedupe ENFORCEMENT = dups merged to 0 AND the partial unique
// index present — item 3 lands both in ONE transaction, so any other
// combination is drift and fails.
export const PHASEB_DUP_PIN = 1578;
export const PHASEB_DUP_GROUPS_SQL = `
SELECT count(*)::int n FROM (
  SELECT from_id, to_id, rel_type FROM lumen.edges
  WHERE collection_id = 'phase-b'
  GROUP BY 1,2,3 HAVING count(*) > 1) d`;
export const PHASEB_INDEX_PRESENT_SQL = `
SELECT count(*)::int n FROM pg_indexes
WHERE schemaname = 'lumen' AND indexname = 'idx_edges_phaseb_unique'`;
export function classifyPhasebDedupe(dupGroups, indexPresent) {
	if (dupGroups === 0 && indexPresent) return 'pass';
	if (dupGroups === PHASEB_DUP_PIN && !indexPresent) return 'baseline-debt';
	return 'fail';
}

// v2 item 7 pin: id↔name first-token mismatch inventory over phase-b
// person/place — the EXACT SQL from the 2026-07-20 probe round (was 311/5,904;
// 310 since the 2026-07-21 bennett rename landed — pin moves with the fix).
// UNTRIAGED INVENTORY value (drift detection), not a verified-benign set.
export const ID_NAME_MISMATCH_PIN = 310;
export const ID_NAME_MISMATCH_SQL = `
WITH p AS (
  SELECT id, name, regexp_replace(regexp_replace(id, '^a-', ''), '-[0-9]+$', '') slug
  FROM lumen.entities
  WHERE collection_id = 'phase-b' AND entity_type IN ('person','place'))
SELECT count(*)::int scanned,
  count(*) FILTER (WHERE position(split_part(slug, '-', 1) IN lower(name)) = 0)::int first_token_missing
FROM p`;
export function classifyIdNameInventory(firstTokenMissing) {
	return firstTokenMissing === ID_NAME_MISMATCH_PIN ? 'baseline-debt' : 'fail';
}

// D4: self-loop IDENTITY pin — tolerate EXACTLY the dc→dc IN_VOLUME phase-b
// row (shared-id flattening artifact; metadata labels disambiguate). Anything
// else — extra loops, a mutated row, or the row VANISHING — fails.
export const SELF_LOOP_ROWS_SQL = `
SELECT from_id, to_id, rel_type, collection_id, source, metadata
FROM lumen.edges WHERE from_id = to_id`;
/** jsonb may arrive as a parsed object or a JSON string depending on the
 * driver path — normalize once, used by classifier AND detail mapping. */
export function parseMeta(metadata) {
	if (typeof metadata !== 'string') return metadata ?? null;
	try { return JSON.parse(metadata); } catch { return null; }
}
export function classifySelfLoopRows(rows) {
	if (rows.length !== 1) return 'fail';
	const r = rows[0];
	const meta = parseMeta(r.metadata);
	const isPinnedRow =
		r.from_id === 'dc' && r.to_id === 'dc' && r.rel_type === 'IN_VOLUME'
		&& r.collection_id === 'phase-b'
		&& meta?.from_label === 'LM_Book' && meta?.to_label === 'LM_Volume';
	return isPinnedRow ? 'baseline-debt' : 'fail';
}

// v2 item 6: LIVE schema diff — the Drizzle defs vs information_schema,
// computed fresh every sweep (a committed snapshot can't catch prod-vs-repo
// drift from standalone migrations).
export function drizzleTableMap(schemaModule = drizzleSchema) {
	const map = {};
	for (const v of Object.values(schemaModule)) {
		if (isDrizzleTable(v, DrizzleTable)) {
			map[getTableName(v)] = Object.values(getTableColumns(v)).map((c) => c.name).sort();
		}
	}
	return map;
}
/** Diff {table: [colNames]} maps. Pure — pinned in the harness tests. */
export function diffSchema(liveMap, drizzleMap) {
	const tables_only_live = Object.keys(liveMap).filter((t) => !(t in drizzleMap)).sort();
	const tables_only_drizzle = Object.keys(drizzleMap).filter((t) => !(t in liveMap)).sort();
	const column_mismatches = [];
	for (const t of Object.keys(drizzleMap).sort()) {
		if (!(t in liveMap)) continue;
		const live = new Set(liveMap[t]);
		const driz = new Set(drizzleMap[t]);
		const only_live = [...live].filter((c) => !driz.has(c)).sort();
		const only_drizzle = [...driz].filter((c) => !live.has(c)).sort();
		if (only_live.length || only_drizzle.length) {
			column_mismatches.push({ table: t, only_live, only_drizzle });
		}
	}
	return { tables_only_live, tables_only_drizzle, column_mismatches };
}

// ── result collection ───────────────────────────────────────────────────────

const results = { integrity: [], load: null, startedAt: new Date().toISOString() };

/** Phase-scoped runs must never clobber the other phase's persisted results
 * (an integrity-only rerun erased the load tables once). Pure — pinned in
 * the harness tests. */
export function mergeResults(existing, current) {
	return {
		...existing,
		...current,
		integrity: current.integrity?.length ? current.integrity : existing?.integrity ?? [],
		load: current.load ?? existing?.load ?? null,
	};
}
function record(dim, name, status, detail = {}) {
	const row = { dim, name, status, ...detail };
	results.integrity.push(row);
	console.log(JSON.stringify({ event: 'check', ...row }));
}

// ── integrity checks ────────────────────────────────────────────────────────

async function runIntegrity(sql) {
	// I1 spine structure
	const spine = [
		['books_have_volumes', `SELECT count(*)::int n FROM lumen.books b LEFT JOIN lumen.volumes v ON v.id = b.volume_id WHERE v.id IS NULL`],
		['chapters_have_books', `SELECT count(*)::int n FROM lumen.chapters c LEFT JOIN lumen.books b ON b.id = c.book_id WHERE b.id IS NULL`],
		['verses_have_chapters', `SELECT count(*)::int n FROM lumen.verses v LEFT JOIN lumen.chapters c ON c.id = v.chapter_id WHERE c.id IS NULL`],
		['verse_id_shape_matches_chapter', `SELECT count(*)::int n FROM lumen.verses v WHERE v.id !~ '^[a-z0-9-]+-[0-9]+$' OR v.id NOT LIKE v.chapter_id || '-%'`],
		['words_have_verses', `SELECT count(*)::int n FROM lumen.words w LEFT JOIN lumen.verses v ON v.id = w.verse_id WHERE v.id IS NULL`],
		['word_tags_have_words', `SELECT count(*)::int n FROM lumen.word_tags wt LEFT JOIN lumen.words w ON w.id = wt.word_id WHERE w.id IS NULL`],
		['word_tags_have_lexicon', `SELECT count(*)::int n FROM (SELECT unnest(wt.strongs) s FROM lumen.word_tags wt WHERE wt.strongs IS NOT NULL) x LEFT JOIN lumen.strongs_lexicon sl ON sl.strongs_no = x.s WHERE sl.strongs_no IS NULL`],
		['words_position_contiguous', `SELECT count(*)::int n FROM (SELECT verse_id FROM lumen.words GROUP BY verse_id HAVING count(*) != count(DISTINCT position)) x`],
	];
	for (const [name, text] of spine) {
		const [r] = await q(sql, text);
		record('I1', name, Number(r.n) === 0 ? 'pass' : 'fail', { violations: Number(r.n) });
	}
	// verse numbering: gaps/dupes per chapter
	const [gaps] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT chapter_id, count(*) c, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx,
			       count(DISTINCT (regexp_match(id, '-([0-9]+)$'))[1]::int) dc
			FROM lumen.verses GROUP BY chapter_id
			HAVING count(*) != max((regexp_match(id, '-([0-9]+)$'))[1]::int)
			    OR count(*) != count(DISTINCT (regexp_match(id, '-([0-9]+)$'))[1]::int)
		) x`);
	record('I1', 'verse_numbering_contiguous_unique', Number(gaps.n) === 0 ? 'pass' : 'fail', { chapters_with_gaps: Number(gaps.n) });

	// I2 referential
	const refs = [
		['transcripts_episode_resolves', `SELECT count(*)::int n FROM lumen.transcripts t LEFT JOIN lumen.entities e ON e.id = t.episode_id WHERE e.id IS NULL`],
		['entities_collection_resolves', `SELECT count(*)::int n FROM lumen.entities e LEFT JOIN lumen.collections c ON c.id = e.collection_id WHERE e.collection_id IS NOT NULL AND c.id IS NULL`],
		['edges_collection_resolves', `SELECT count(*)::int n FROM lumen.edges ed LEFT JOIN lumen.collections c ON c.id = ed.collection_id WHERE ed.collection_id IS NOT NULL AND c.id IS NULL`],
		['user_roles_resolve', `SELECT count(*)::int n FROM lumen.user_roles ur LEFT JOIN lumen.roles r ON r.slug = ur.role_slug WHERE r.slug IS NULL`],
		['search_index_collection_resolves', `SELECT count(*)::int n FROM lumen.search_index si LEFT JOIN lumen.collections c ON c.id = si.collection_id WHERE si.collection_id IS NOT NULL AND c.id IS NULL`],
	];
	for (const [name, text] of refs) {
		const [r] = await q(sql, text);
		record('I2', name, Number(r.n) === 0 ? 'pass' : 'fail', { violations: Number(r.n) });
	}
	// edges endpoint resolution — kind-aware across every target family
	const [edgeOrphans] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges ed
		WHERE NOT EXISTS (SELECT 1 FROM lumen.entities e WHERE e.id = ed.from_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.chapters c WHERE c.id = ed.from_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = ed.from_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.books b WHERE b.id = ed.from_id)`);
	record('I2', 'edge_from_resolves_somewhere', Number(edgeOrphans.n) === 0 ? 'pass' : 'fail', { violations: Number(edgeOrphans.n) });
	const [edgeToOrphans] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges ed
		WHERE NOT EXISTS (SELECT 1 FROM lumen.entities e WHERE e.id = ed.to_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.chapters c WHERE c.id = ed.to_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = ed.to_id)
		  AND NOT EXISTS (SELECT 1 FROM lumen.books b WHERE b.id = ed.to_id)`);
	record('I2', 'edge_to_resolves_somewhere', Number(edgeToOrphans.n) === 0 ? 'pass' : 'fail', { violations: Number(edgeToOrphans.n) });

	// I3 uniqueness
	const pkTables = ['volumes', 'books', 'chapters', 'verses', 'words', 'word_tags', 'entities', 'edges', 'collections', 'transcripts', 'search_index', 'strongs_lexicon', 'roles', 'user_roles'];
	const pkRows = await q(sql, `
		SELECT c.relname AS t FROM pg_class c
		JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'lumen' AND c.relkind = 'r'
		  AND NOT EXISTS (
		    SELECT 1 FROM pg_constraint x WHERE x.conrelid = c.oid AND x.contype = 'p')`);
	const noPk = pkRows.map((r) => r.t);
	record('I3', 'tables_have_primary_keys', noPk.filter((t) => t !== 'edges' && t !== 'migration_state').length === 0 ? 'pass' : 'fail', {
		no_pk: noPk, note: 'edges + migration_state known PK-less (baseline)',
	});
	const dupes = await q(sql, `
		SELECT collection_id, count(*)::int n FROM (
			SELECT from_id, to_id, rel_type, collection_id FROM lumen.edges
			GROUP BY 1,2,3,4 HAVING count(*) > 1) d GROUP BY 1 ORDER BY 2 DESC`);
	for (const d of dupes) {
		// methodology finding 8: baseline-debt is PINNED to the exact count —
		// NEW dupes inside phase-b must fail, not hide under the baseline.
		const status =
			d.collection_id === 'phase-b'
				? Number(d.n) === 1578
					? 'baseline-debt'
					: 'fail'
				: 'fail';
		record('I3', `dup_edge_tuples_${d.collection_id}`, status, {
			dup_tuples: Number(d.n),
			...(d.collection_id === 'phase-b' ? { pinned_baseline: 1578 } : {}),
		});
	}
	if (!dupes.length) record('I3', 'dup_edge_tuples', 'pass', {});

	// I4 value domains
	const [badEntityTypes] = await q(sql, `SELECT count(*)::int n, array_agg(DISTINCT entity_type) FILTER (WHERE NOT (entity_type = ANY($1))) bad FROM lumen.entities WHERE NOT (entity_type = ANY($1))`, [[...ENTITY_TYPES]]);
	record('I4', 'entity_types_in_vocab', Number(badEntityTypes.n) === 0 ? 'pass' : 'fail', { violations: Number(badEntityTypes.n), bad: badEntityTypes.bad });
	const [badRelTypes] = await q(sql, `SELECT count(*)::int n, array_agg(DISTINCT rel_type) FILTER (WHERE NOT (rel_type = ANY($1))) bad FROM lumen.edges WHERE NOT (rel_type = ANY($1))`, [[...PG_REL_TYPES]]);
	record('I4', 'rel_types_in_vocab', Number(badRelTypes.n) === 0 ? 'pass' : 'fail', { violations: Number(badRelTypes.n), bad: badRelTypes.bad });
	const metaTables = await q(sql, META_TABLES_SQL);
	for (const { table_name: table } of metaTables) {
		const [r] = await q(sql, `SELECT count(*)::int n FROM lumen.${table} WHERE metadata IS NOT NULL AND jsonb_typeof(metadata) != 'object'`);
		record('I4', `${table}_metadata_object_typed`, Number(r.n) === 0 ? 'pass' : 'fail', { violations: Number(r.n) });
	}
	const [badSource] = await q(sql, `SELECT count(*)::int n, array_agg(DISTINCT source) FILTER (WHERE source IS NOT NULL AND NOT (source = ANY($1))) other FROM lumen.edges WHERE collection_id = 'unshaken' AND source IS NOT NULL AND NOT (source = ANY($1))`, [KNOWN_SOURCES]);
	record('I4', 'unshaken_edge_sources_known', Number(badSource.n) === 0 ? 'pass' : 'fail', { violations: Number(badSource.n), other: badSource.other });

	// I5 extraction layer
	const [badMentions] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges ed, LATERAL jsonb_array_elements(ed.metadata->'mentions') m
		WHERE ed.collection_id = 'unshaken' AND ed.source = 'unshaken-extraction'
		  AND (jsonb_typeof(m->'t') != 'number' OR jsonb_typeof(m->'seq') != 'number'
		       OR (m->>'confidence')::numeric < 0.5 OR (m->>'confidence')::numeric > 1)`);
	record('I5', 'mention_schema_and_bounds', Number(badMentions.n) === 0 ? 'pass' : 'fail', { violations: Number(badMentions.n) });
	const [mentionSeqs] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges ed, LATERAL jsonb_array_elements(ed.metadata->'mentions') m
		WHERE ed.collection_id = 'unshaken' AND ed.source = 'unshaken-extraction'
		  AND NOT EXISTS (
		    SELECT 1 FROM lumen.transcripts t
		    WHERE t.episode_id = ed.from_id AND t.seq = (m->>'seq')::int)`);
	record('I5', 'mention_seqs_exist_in_transcripts', Number(mentionSeqs.n) === 0 ? 'pass' : 'fail', { violations: Number(mentionSeqs.n) });
	const [mentionT] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges ed
		JOIN lumen.entities e ON e.id = ed.from_id,
		LATERAL jsonb_array_elements(ed.metadata->'mentions') m
		WHERE ed.collection_id = 'unshaken' AND ed.source = 'unshaken-extraction'
		  AND (m->>'t')::numeric > (e.metadata->'media'->>'duration_s')::numeric + 5`);
	record('I5', 'mention_t_within_duration', Number(mentionT.n) === 0 ? 'pass' : 'fail', { violations: Number(mentionT.n) });
	const [trapFields] = await q(sql, TRAP_FIELD_PROBE_SQL);
	record('I5', 'no_trap_fields_in_stored_metadata', Number(trapFields.n) === 0 ? 'pass' : 'fail', { violations: Number(trapFields.n) });
	const [titleConf] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges
		WHERE collection_id = 'unshaken' AND source = 'unshaken-youtube' AND (metadata->>'confidence')::numeric != 1`);
	record('I5', 'title_edges_confidence_1', Number(titleConf.n) === 0 ? 'pass' : 'fail', { violations: Number(titleConf.n) });

	// I6 transcripts
	const [seqGaps] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT episode_id FROM lumen.transcripts GROUP BY episode_id
			HAVING count(*) != max(seq) + 1 OR min(seq) != 0 OR count(*) != count(DISTINCT seq)) x`);
	record('I6', 'transcript_seq_contiguous', Number(seqGaps.n) === 0 ? 'pass' : 'fail', { episodes_with_gaps: Number(seqGaps.n) });
	const [tMono] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT episode_id, seq, t_start_s,
			       lag(t_start_s) OVER (PARTITION BY episode_id ORDER BY seq) prev
			FROM lumen.transcripts) x WHERE prev IS NOT NULL AND t_start_s < prev`);
	record('I6', 'transcript_t_monotonic', Number(tMono.n) === 0 ? 'pass' : 'fail', { violations: Number(tMono.n) });
	const [tEnd] = await q(sql, `SELECT count(*)::int n FROM lumen.transcripts WHERE t_end_s IS NOT NULL AND t_end_s < t_start_s`);
	record('I6', 'transcript_t_end_after_start', Number(tEnd.n) === 0 ? 'pass' : 'fail', { violations: Number(tEnd.n) });
	const [emptyText] = await q(sql, `SELECT count(*)::int n FROM lumen.transcripts WHERE length(trim(text)) = 0`);
	record('I6', 'transcript_no_empty_text', Number(emptyText.n) === 0 ? 'pass' : 'fail', { violations: Number(emptyText.n) });
	const [coverage] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT t.episode_id, max(t.t_end_s) mx, (e.metadata->'media'->>'duration_s')::numeric dur
			FROM lumen.transcripts t JOIN lumen.entities e ON e.id = t.episode_id
			GROUP BY t.episode_id, e.metadata
			HAVING max(t.t_end_s) < (e.metadata->'media'->>'duration_s')::numeric - 300) x`);
	record('I6', 'transcript_coverage_within_tolerance', Number(coverage.n) === 0 ? 'pass' : 'fail', { episodes_undercovered: Number(coverage.n) });

	// I7 text/encoding sweep (per major text column)
	const textCols = [
		['verses', 'text'], ['transcripts', 'text'], ['entities', 'name'],
		['entities', 'description'], ['strongs_lexicon', 'definition'],
	];
	for (const [table, col] of textCols) {
		const [r] = await q(sql, encodingSweepSQL(table, col));
		const bad = Number(r.repl) + Number(r.dblenc) + Number(r.huge);
		record('I7', `${table}_${col}_encoding`, bad === 0 ? 'pass' : 'fail', {
			replacement: Number(r.repl), double_encoded: Number(r.dblenc), huge: Number(r.huge),
			note: 'NUL probe removed — PG text forbids NUL by construction',
		});
	}

	// I8 numeric hygiene
	const numCols = [
		['transcripts', 't_start_s'], ['transcripts', 't_end_s'],
	];
	for (const [table, col] of numCols) {
		const [r] = await q(sql, `SELECT count(*)::int n FROM lumen.${table} WHERE ${col} = 'NaN'::numeric OR ${col} < 0`);
		record('I8', `${table}_${col}_finite_nonneg`, Number(r.n) === 0 ? 'pass' : 'fail', { violations: Number(r.n) });
	}
	const [confNaN] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges
		WHERE metadata ? 'confidence' AND (metadata->>'confidence') IN ('NaN', 'Infinity', '-Infinity', 'null')`);
	record('I8', 'edge_confidence_finite', Number(confNaN.n) === 0 ? 'pass' : 'fail', { violations: Number(confNaN.n) });

	// I10 search
	const [siNull] = await q(sql, `SELECT count(*)::int n FROM lumen.search_index WHERE tsv IS NULL`);
	record('I10', 'search_tsv_nonnull', Number(siNull.n) === 0 ? 'pass' : 'fail', { violations: Number(siNull.n) });
	const [siHit] = await q(sql, `
		SELECT count(*)::int n FROM lumen.search_index
		WHERE kind = 'episode' AND tsv @@ websearch_to_tsquery('english', 'Kings')`);
	record('I10', 'search_content_canary', Number(siHit.n) > 0 ? 'pass' : 'fail', { hits: Number(siHit.n) });
}

// ── coverage-review extensions (design review 2026-07-18) ───────────────────

const LM_LABELS = [
	'LM_Verse', 'LM_Principle', 'LM_Person', 'LM_Place', 'LM_Chapter', 'LM_Book',
	'LM_Volume', 'LM_StrongsWord', 'LM_JstReading', 'LM_ChapterSummary',
	'LM_NaveTopic', 'LM_Era', 'LM_Event', 'LM_Symbol',
];

async function runIntegrityExtended(sql) {
	// I11 metadata-linkage collections (coverage F1: 77% of entities link via
	// metadata conventions, not edges — previously invisible to the sweep)
	const [jst] = await q(sql, JST_DANGLING_SPLIT_SQL);
	record('I11', 'jst_verse_id_links_resolve', Number(jst.corrupt) === 0 ? 'pass' : 'fail', {
		corrupt_dangling: Number(jst.corrupt),
	});
	// v2 item 4 shipped 2026-07-21: the 427 beyond-canon-end readings carry
	// placement+anchor stamps — the pin is a HARD ZERO on unanchored now
	record('I11', 'jst_addition_verses_unanchored', Number(jst.unanchored) === 0 && Number(jst.additions) === 427 ? 'pass' : 'fail', {
		additions: Number(jst.additions), unanchored: Number(jst.unanchored), pinned_additions: 427,
		note: 'beyond-canon-end readings stamped placement=beyond_canon_end + anchor_verse_id (v2 item 4, 2026-07-21) — unanchored must stay 0, additions pinned at 427',
	});
	const [strongsLink] = await q(sql, `
		SELECT count(*) FILTER (WHERE sl.strongs_no IS NULL)::int dangling,
		       count(*)::int total
		FROM lumen.entities e
		LEFT JOIN lumen.strongs_lexicon sl ON sl.strongs_no = e.id
		WHERE e.collection_id = 'strongs'`);
	record('I11', 'strongs_entities_resolve_to_lexicon', Number(strongsLink.dangling) === 0 ? 'pass' : 'fail', {
		dangling: Number(strongsLink.dangling), entities: Number(strongsLink.total), lexicon_rows: 20734,
		note: 'entity<lexicon asymmetry (14k vs 21k) = lexicon rows without word entities, expected',
	});
	const [navesShape] = await q(sql, `
		SELECT count(*)::int n FROM lumen.entities
		WHERE collection_id = 'naves'
		  AND (length(trim(name)) = 0 OR metadata->>'section' IS NULL
		       OR (metadata->>'entry_count') !~ '^[0-9]+$')`);
	record('I11', 'naves_topics_well_formed', Number(navesShape.n) === 0 ? 'pass' : 'fail', { violations: Number(navesShape.n) });
	record('I11', 'naves_has_no_canon_linkage', 'baseline-debt', {
		note: 'naves topics carry no verse/edge linkage AT ALL — product gap, not corruption; surfaced for the roadmap',
	});

	// I12 drizzle-schema drift (coverage F2) — UPGRADED to a LIVE diff
	// (remediation v2 item 6): drizzle defs vs information_schema every sweep.
	const liveCols = await q(sql, `
		SELECT table_name, string_agg(column_name, ',' ORDER BY ordinal_position) cols
		FROM information_schema.columns WHERE table_schema = 'lumen'
		GROUP BY table_name`);
	const liveMap = Object.fromEntries(liveCols.map((r) => [r.table_name, r.cols.split(',')]));
	const drift = diffSchema(liveMap, drizzleTableMap());
	record('I12', 'drizzle_schema_drift', 'baseline-debt', {
		...drift,
		note: 'known drift, tracked as debt — full schema.ts regen rides the next schema-touching feature (v2 item 6); harness checks stay driven from information_schema',
	});

	// I1 extension: words offsets + substring agreement (coverage F5)
	const [wordOffsets] = await q(sql, `
		SELECT count(*)::int n FROM lumen.words w
		JOIN lumen.verses v ON v.id = w.verse_id
		WHERE w.char_start IS NOT NULL
		  AND (w.char_start < 0 OR w.char_end <= w.char_start OR w.char_end > length(v.text) + 1)`);
	record('I1', 'word_char_offsets_within_verse', Number(wordOffsets.n) === 0 ? 'pass' : 'fail', { violations: Number(wordOffsets.n) });
	const [substrAgree] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT w.surface, substring(v.text FROM w.char_start + 1 FOR w.char_end - w.char_start) sub
			FROM lumen.words w JOIN lumen.verses v ON v.id = w.verse_id
			WHERE w.char_start IS NOT NULL
			ORDER BY random() LIMIT 2000) x
		WHERE x.surface IS DISTINCT FROM x.sub`);
	record('I1', 'word_surface_matches_verse_substring_sampled', Number(substrAgree.n) === 0 ? 'pass' : 'fail', {
		mismatches_in_2000: Number(substrAgree.n),
	});

	// I13 openbible payload (coverage F6)
	const [obBad] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges
		WHERE collection_id = 'openbible' AND rel_type = 'CROSS_REF'
		  AND (metadata->>'votes') !~ '^-?[0-9]+$'`);
	record('I13', 'openbible_votes_numeric', Number(obBad.n) === 0 ? 'pass' : 'fail', { violations: Number(obBad.n) });
	const [obOverlap] = await q(sql, `
		SELECT count(*)::int n FROM lumen.edges a
		JOIN lumen.edges b ON b.from_id = a.from_id AND b.to_id = a.to_id AND b.rel_type = 'CROSS_REF'
		WHERE a.collection_id = 'openbible' AND b.collection_id = 'phase-b' AND a.rel_type = 'CROSS_REF'`);
	record('I13', 'openbible_phaseb_semantic_overlap', 'baseline-debt', {
		overlapping_pairs: Number(obOverlap.n),
		note: 'cross-collection semantic duplicates — inventory for the collections cleanup, not corruption',
	});

	// I14 rel_type × collection matrix + self-loops (coverage F7/F8)
	const matrix = await q(sql, `
		SELECT collection_id, rel_type, count(*)::int n FROM lumen.edges
		GROUP BY 1, 2 ORDER BY 1, 2`);
	const ALLOWED = {
		art: ['DEPICTS', 'FEATURES'],
		openbible: ['CROSS_REF'],
		unshaken: ['DISCUSSES', 'MENTIONS', 'TEACHES'],
	};
	const matrixViolations = matrix.filter(
		(r) => ALLOWED[r.collection_id] && !ALLOWED[r.collection_id].includes(r.rel_type),
	);
	record('I14', 'rel_type_collection_matrix', matrixViolations.length === 0 ? 'pass' : 'fail', {
		violations: matrixViolations, matrix_size: matrix.length,
	});
	const [selfLoops] = await q(sql, `SELECT count(*)::int n FROM lumen.edges WHERE from_id = to_id`);
	record('I14', 'self_loop_edges', Number(selfLoops.n) <= 1 ? 'baseline-debt' : 'fail', {
		self_loops: Number(selfLoops.n), note: '1 known live self-loop = pinned baseline',
	});
	const isolation = await q(sql, `
		SELECT e.entity_type, count(*)::int n FROM lumen.entities e
		WHERE e.collection_id NOT IN ('jst', 'strongs', 'naves')
		  AND NOT EXISTS (SELECT 1 FROM lumen.edges ed WHERE ed.from_id = e.id OR ed.to_id = e.id)
		GROUP BY 1 ORDER BY 2 DESC`);
	record('I14', 'edge_isolated_relational_entities', 'baseline-debt', {
		by_type: Object.fromEntries(isolation.map((r) => [r.entity_type, Number(r.n)])),
		note: 'expected-isolated collections exempted; counts inventoried for graph-membership feature',
	});

	// I16 strongs lexicon domains (coverage F10)
	const [lexBad] = await q(sql, `
		SELECT count(*) FILTER (WHERE strongs_no !~ '${STRONGS_NO_PATTERN}')::int bad_no,
		       count(*) FILTER (WHERE lang NOT IN ('hebrew', 'greek', 'H', 'G'))::int bad_lang,
		       count(*) FILTER (WHERE length(trim(coalesce(gloss, ''))) = 0 AND length(trim(coalesce(definition, ''))) = 0)::int empty_both
		FROM lumen.strongs_lexicon`);
	record('I16', 'strongs_lexicon_domains', Number(lexBad.bad_no) === 0 && Number(lexBad.empty_both) === 0 ? 'pass' : 'fail', {
		bad_strongs_no: Number(lexBad.bad_no), bad_lang: Number(lexBad.bad_lang), empty_gloss_and_definition: Number(lexBad.empty_both),
	});
	const [tagCoverage] = await q(sql, `
		SELECT (count(DISTINCT wt.word_id)::numeric / (SELECT count(*) FROM lumen.words WHERE verse_id LIKE '%'))::numeric(5,4) AS cov
		FROM lumen.word_tags wt`);
	record('I16', 'strongs_tag_coverage_vs_baseline', Number(tagCoverage.cov) >= 0.55 ? 'pass' : 'fail', {
		coverage: Number(tagCoverage.cov),
		note: 'ingest baseline 0.9353 was OT+NT-scoped; whole-spine coverage is lower by construction — floor set at 0.55',
	});

	// I17 small-table domains (coverage F11)
	const [collDomains] = await q(sql, `
		SELECT count(*) FILTER (WHERE tier NOT IN ('base', 'app', 'enrichment', 'community', 'personal'))::int bad_tier,
		       count(*) FILTER (WHERE category IS NOT NULL AND category NOT IN ('scripture', 'reference', 'art', 'podcast', 'topical'))::int bad_cat
		FROM lumen.collections`);
	record('I17', 'collection_tier_category_domains', Number(collDomains.bad_tier) === 0 ? 'pass' : 'fail', {
		bad_tier: Number(collDomains.bad_tier), bad_category: Number(collDomains.bad_cat),
	});
	const [roleShape] = await q(sql, `
		SELECT count(*)::int n FROM lumen.roles
		WHERE entitlements IS NULL OR array_length(entitlements, 1) IS NULL`);
	record('I17', 'roles_have_entitlements', Number(roleShape.n) === 0 ? 'pass' : 'fail', { empty: Number(roleShape.n) });

	// I18 tsvector freshness sample (coverage F12: non-null ≠ fresh)
	const [staleTsv] = await q(sql, `
		SELECT count(*)::int n FROM (
			SELECT search_vector, to_tsvector('english', text) fresh
			FROM lumen.verses ORDER BY random() LIMIT 1000) x
		WHERE x.search_vector IS DISTINCT FROM x.fresh`);
	record('I18', 'verses_tsvector_fresh_sampled', Number(staleTsv.n) === 0 ? 'pass' : 'fail', { stale_in_1000: Number(staleTsv.n) });

	// I10 extension: the REAL search surfaces (coverage F4)
	const [vFts] = await q(sql, `SELECT count(*)::int n FROM lumen.verses WHERE search_vector @@ websearch_to_tsquery('english', 'faith')`);
	record('I10', 'verses_fts_canary', Number(vFts.n) > 100 ? 'pass' : 'fail', { hits: Number(vFts.n) });
	const [eFts] = await q(sql, `SELECT count(*)::int n FROM lumen.entities WHERE search_vector @@ websearch_to_tsquery('english', 'Hezekiah')`);
	record('I10', 'entities_fts_canary', Number(eFts.n) > 0 ? 'pass' : 'fail', { hits: Number(eFts.n) });

	// ── remediation-v2 sweep pins (2026-07-21) ──────────────────────────────
	// I3 extension (v2 item 3): dedupe ENFORCEMENT — dup groups AND the
	// partial unique index, classified together (they land in one tx).
	const [dupGroups] = await q(sql, PHASEB_DUP_GROUPS_SQL);
	const [idx] = await q(sql, PHASEB_INDEX_PRESENT_SQL);
	const indexPresent = Number(idx.n) > 0;
	record('I3', 'phaseb_dedupe_enforced', classifyPhasebDedupe(Number(dupGroups.n), indexPresent), {
		dup_tuples: Number(dupGroups.n),
		index_present: indexPresent,
		pinned_baseline: { dup_tuples: PHASEB_DUP_PIN, index_present: false },
		note: 'flips to pass when item 3 ships (merge → 0 dups + idx_edges_phaseb_unique created in the same tx); any other combination is drift',
	});

	// I15 (v2 item 7): id↔name first-token UNTRIAGED inventory pin.
	const [idName] = await q(sql, ID_NAME_MISMATCH_SQL);
	record('I15', 'phaseb_id_name_first_token_inventory', classifyIdNameInventory(Number(idName.first_token_missing)), {
		scanned: Number(idName.scanned),
		first_token_missing: Number(idName.first_token_missing),
		pinned_baseline: ID_NAME_MISMATCH_PIN,
		note: 'untriaged INVENTORY value (drift detection), not verified-benign — item 7 executes the full 311-row triage and moves the pin to 310 with the bennett rename',
	});

	// I14 extension (D4): self-loop IDENTITY pin — the count check above
	// stays; this pins WHICH row the one tolerated loop is.
	const selfLoopRows = await q(sql, SELF_LOOP_ROWS_SQL);
	record('I14', 'self_loop_identity_pin', classifySelfLoopRows(selfLoopRows), {
		rows: selfLoopRows.map((r) => {
			const m = parseMeta(r.metadata);
			return {
				from_id: r.from_id, to_id: r.to_id, rel_type: r.rel_type, collection_id: r.collection_id,
				from_label: m?.from_label, to_label: m?.to_label,
			};
		}),
		note: 'D4: exactly the dc→dc IN_VOLUME phase-b row (shared-id flattening artifact; metadata labels disambiguate) is tolerated — anything else, including its disappearance, fails',
	});
}

// I9 Neo4j parity — the house pattern (backfill-neo4j-collections.mjs):
// URI/USER/DATABASE from apps/web/wrangler.json vars, password from
// .dev.vars, HTTPS Query API v2. Degrades to skipped when unavailable.
async function runNeo4jParity(sql) {
	let endpoint;
	let auth;
	try {
		const wrangler = JSON.parse(readFileSync(join(ROOT, 'apps/web/wrangler.json'), 'utf8'));
		const devVars = readFileSync(join(ROOT, 'apps/web/.dev.vars'), 'utf8');
		const password = devVars.match(/^NEO4J_PASSWORD=(.+)$/m)?.[1]?.trim();
		if (!wrangler.vars?.NEO4J_URI || !password) throw new Error('neo4j vars incomplete');
		endpoint = `${wrangler.vars.NEO4J_URI.replace('neo4j+s://', 'https://')}/db/${wrangler.vars.NEO4J_DATABASE}/query/v2`;
		auth = 'Basic ' + Buffer.from(`${wrangler.vars.NEO4J_USER}:${password}`).toString('base64');
	} catch (err) {
		record('I9', 'neo4j_parity', 'skipped', { reason: scrubSecrets(err.message).slice(0, 80) });
		return;
	}
	const cypher = async (statement) => {
		const res = await fetch(endpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: auth },
			// the PG write-verb rail covers Cypher's too (MERGE/CREATE/DELETE)
			body: JSON.stringify({ statement: assertReadOnly(statement), parameters: {} }),
		});
		const body = await res.json();
		if (!res.ok || body.errors?.length) {
			throw new Error(`neo4j query failed: ${body.errors?.[0]?.message ?? res.status}`);
		}
		const fields = body.data?.fields ?? [];
		return (body.data?.values ?? []).map((v) => Object.fromEntries(fields.map((f, i) => [f, v[i]])));
	};
	try {
		const counts = {};
		for (const label of LM_LABELS) {
			const [row] = await cypher(`MATCH (n:${label}) RETURN count(n) AS n`);
			counts[label] = Number(row.n);
		}
		const [orphan] = await cypher(
			`MATCH (a)-[r]->(b)
			 WHERE any(l IN labels(a) WHERE l STARTS WITH 'LM_')
			   AND NOT any(l IN labels(b) WHERE l STARTS WITH 'LM_')
			 RETURN count(r) AS n`,
		);
		const [pg] = await q(sql, `
			SELECT (SELECT count(*)::int FROM lumen.verses) verses,
			       (SELECT count(*)::int FROM lumen.chapters) chapters,
			       (SELECT count(*)::int FROM lumen.books) books`);
		const parity = {
			LM_Verse: [counts.LM_Verse, Number(pg.verses)],
			LM_Chapter: [counts.LM_Chapter, Number(pg.chapters)],
			LM_Book: [counts.LM_Book, Number(pg.books)],
		};
		const mismatches = Object.entries(parity).filter(([, [g, p]]) => g !== p);
		record('I9', 'neo4j_label_counts', mismatches.length === 0 ? 'pass' : 'fail', {
			parity,
			all_labels: counts,
			note: 'localized 2026-07-18: D&C holds 294/3,654 graph verses — backfill predates/truncated the D&C load; graph-membership feature owns the re-sync',
		});
		record('I9', 'neo4j_never_synced_labels', 'baseline-debt', {
			zero_labels: LM_LABELS.filter((l) => counts[l] === 0),
			note: 'labels defined in the backfill but never populated (strongs/jst/naves) — documented gap, joins extraction+art in the graph-membership backlog',
		});
		record('I9', 'neo4j_no_orphan_lm_relationships', Number(orphan.n) === 0 ? 'pass' : 'fail', { orphan_rels: Number(orphan.n) });
		record('I9', 'neo4j_known_missing_classes', 'baseline-debt', {
			note: 'A2 extraction edges + art collection are documented KNOWN-MISSING from the graph (graph-membership feature)',
		});

		// ── remediation-v2 item 1 pins (2026-07-21) ─────────────────────────
		// Per-volume DIRECTIONAL verse parity — graph ids paged stably, volume
		// attribution local from PG books, both directions reported raw.
		const graphIds = [];
		for (let skip = 0; ; skip += GRAPH_VERSE_PAGE) {
			if (skip > 1_000_000) {
				// a graph exploding past 1M verse ids is a DETECTED ANOMALY, not a
				// transient — record a hard fail (exit-code-visible) before bailing;
				// real fetch errors still fall through to the section's skipped path
				record('I9', 'neo4j_per_volume_verse_parity', 'fail', {
					note: 'paging runaway: >1M LM_Verse ids — graph anomaly, parity not computable',
				});
				throw new Error('LM_Verse paging runaway (>1M ids)');
			}
			const page = await cypher(graphVersePageCypher(skip));
			for (const r of page) graphIds.push(r.id);
			if (page.length < GRAPH_VERSE_PAGE) break;
		}
		const pgVerseRows = await q(sql, `SELECT id FROM lumen.verses ORDER BY id`);
		const books = await q(sql, `SELECT id, volume_id FROM lumen.books ORDER BY id`);
		const { pgOnly, graphOnly } = diffIdSets(pgVerseRows.map((r) => r.id), graphIds);
		const pgNotInGraph = mapVerseIdsToVolumes(pgOnly, books);
		const graphNotInPg = mapVerseIdsToVolumes(graphOnly, books);
		record('I9', 'neo4j_per_volume_verse_parity', pgOnly.length === 0 && graphOnly.length === 0 ? 'pass' : 'fail', {
			pg_not_in_graph_by_volume: pgNotInGraph.byVolume,
			graph_not_in_pg_by_volume: graphNotInPg.byVolume,
			pg_ids_unmatched_to_book: pgNotInGraph.unknown.length,
			graph_ids_unmatched_to_book: graphNotInPg.unknown.length,
			...(graphNotInPg.unknown.length ? { graph_unmatched_sample: graphNotInPg.unknown.slice(0, 5) } : {}),
			pg_verses: pgVerseRows.length,
			graph_verses: graphIds.length,
			note: 'directional per-volume counts, NEVER netted — expected fail until item 1 (D&C 3,360 + PGP 635 re-sync) ships; flips to hard pass at parity',
		});

		// Consumer two-hop pin — flips baseline-debt → pass when item 1 ships.
		const [twoHop] = await cypher(TWO_HOP_DC_76_22_CYPHER);
		const paths = Number(twoHop?.paths ?? 0);
		record('I9', 'neo4j_consumer_two_hop_dc_76_22', paths > 0 ? 'pass' : 'baseline-debt', {
			paths,
			pinned_baseline: 0,
			note: 'pre-sync pinned state: dc-76-22 absent → 0 two-hop paths. Synced comparator dc-4-2 measured 399 paths 2026-07-20.',
		});
	} catch (err) {
		record('I9', 'neo4j_parity', 'skipped', { reason: scrubSecrets(err.message).slice(0, 120) });
	}
}

export { runIntegrity, runIntegrityExtended, runNeo4jParity, assertReadOnly };

function persistMerged() {
	let existing = null;
	try {
		existing = JSON.parse(readFileSync(join(OUT_DIR, 'results.json'), 'utf8'));
	} catch {
		existing = null;
	}
	return mergeResults(existing, results);
}

async function main() {
	const phase = process.argv.find((a) => a.startsWith('--phase='))?.slice(8) ?? 'all';
	mkdirSync(OUT_DIR, { recursive: true });
	let sql;
	try {
		const url = readFileSync(join(ROOT, '.env'), 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
		if (!url) throw new Error('DATABASE_URL not found');
		const require = createRequire(import.meta.url);
		sql = require('postgres')(url, {
			prepare: false,
			max: 4,
			connection: { statement_timeout: 120000 },
		});
		await sql`SET default_transaction_read_only = on`;
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		process.exit(1);
	}
	try {
		// methodology finding 4: LOAD runs FIRST — the integrity sweep reads
		// every table and warms the whole cache, which would turn the storm
		// into cache theater.
		const { runLoad } = await import('./stress-test-load.mjs');
		if (phase === 'load' || phase === 'all') {
			results.load = await runLoad({ ROOT, assertReadOnly, log: (e) => console.log(JSON.stringify(e)) });
			// persist incrementally — a late integrity FATAL must not lose the storm
			writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(persistMerged(), null, 1));
		}
		if (phase === 'integrity' || phase === 'all') {
			await runIntegrity(sql);
			await runIntegrityExtended(sql);
			await runNeo4jParity(sql);
		}
	} catch (err) {
		console.error('FATAL:', scrubSecrets(err.message));
		await sql.end();
		process.exit(1);
	}
	results.finishedAt = new Date().toISOString();
	writeFileSync(join(OUT_DIR, 'results.json'), JSON.stringify(persistMerged(), null, 1));
	await sql.end();
	const failures = results.integrity.filter((r) => r.status === 'fail');
	const debt = results.integrity.filter((r) => r.status === 'baseline-debt');
	console.log(JSON.stringify({ event: 'done', checks: results.integrity.length, failures: failures.length, baseline_debt: debt.length }));
	process.exit(failures.length ? 2 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main();
}
