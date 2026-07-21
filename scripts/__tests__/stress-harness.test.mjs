// Stress-harness pins (Abram 2026-07-18: "each fix needs a test").
// Every run-discovered harness bug gets its regression pin here.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
	assertReadOnly,
	TRAP_FIELD_PROBE_SQL,
	encodingSweepSQL,
	META_TABLES_SQL,
	JST_DANGLING_SPLIT_SQL,
	STRONGS_NO_PATTERN,
	GRAPH_VERSE_PAGE,
	graphVersePageCypher,
	mapVerseIdsToVolumes,
	diffIdSets,
	TWO_HOP_DC_76_22_CYPHER,
	PHASEB_DUP_PIN,
	PHASEB_DUP_GROUPS_SQL,
	PHASEB_INDEX_PRESENT_SQL,
	classifyPhasebDedupe,
	ID_NAME_MISMATCH_PIN,
	ID_NAME_MISMATCH_SQL,
	classifyIdNameInventory,
	SELF_LOOP_ROWS_SQL,
	classifySelfLoopRows,
	drizzleTableMap,
	diffSchema,
} from '../stress-test-data.mjs';
import { pct, classifyError, RUNGS, POOLER_SESSION_CAP } from '../stress-test-load.mjs';

// ── the read-only rail (the harness's core safety property) ─────────────────

test('assertReadOnly rejects every write verb, case-insensitive', () => {
	for (const verb of ['INSERT', 'insert', 'Update', 'DELETE', 'TRUNCATE', 'DROP', 'ALTER', 'CREATE', 'GRANT', 'REVOKE', 'COPY', 'VACUUM', 'MERGE']) {
		assert.throws(() => assertReadOnly(`${verb} something`), /write verb/i, verb);
	}
});

test('assertReadOnly passes reads, including CTEs and EXPLAIN-free selects', () => {
	for (const ok of [
		'SELECT count(*) FROM lumen.edges',
		'WITH x AS (SELECT 1) SELECT * FROM x',
		"SELECT setting FROM pg_settings WHERE name = 'max_connections'",
	]) {
		assert.equal(assertReadOnly(ok), ok);
	}
});

test('assertReadOnly is not fooled by verbs inside identifiers', () => {
	// \b boundaries: 'created_at' contains 'create' but not as a word
	assert.equal(
		assertReadOnly('SELECT created_at, updated_col FROM lumen.roles'),
		'SELECT created_at, updated_col FROM lumen.roles',
	);
});

// ── run-2 fix: trap-field probe (LIKE __ wildcards matched the word "trap"
// in 233 transcript quotes; strpos exact count was 0) ───────────────────────

test('trap probe uses exact strpos, never LIKE wildcards', () => {
	assert.match(TRAP_FIELD_PROBE_SQL, /strpos\(metadata::text, '__trap'\)/);
	assert.doesNotMatch(TRAP_FIELD_PROBE_SQL, /LIKE\s+'%__trap%'/i);
	assert.equal(assertReadOnly(TRAP_FIELD_PROBE_SQL), TRAP_FIELD_PROBE_SQL);
});

// ── run-2 fix: encoding sweep (chr(0) is a PG error AND unnecessary — PG
// text forbids NUL by construction) ─────────────────────────────────────────

test('encoding sweep carries no NUL probe and stays read-only', () => {
	const sql = encodingSweepSQL('verses', 'text');
	assert.doesNotMatch(sql, /chr\(0\)/);
	assert.match(sql, /chr\(65533\)/); // replacement-char probe stays
	assert.match(sql, /&amp;/); // double-encoding probe stays
	assert.match(sql, /100000/); // pathological-length probe stays
	assert.equal(assertReadOnly(sql), sql);
});

// ── run-1 fix: metadata columns DISCOVERED from information_schema
// (hardcoded list assumed collections.metadata and FATAL'd the run) ──────────

test('metadata tables come from information_schema, not assumptions', () => {
	assert.match(META_TABLES_SQL, /information_schema\.columns/);
	assert.match(META_TABLES_SQL, /column_name = 'metadata'/);
	assert.equal(assertReadOnly(META_TABLES_SQL), META_TABLES_SQL);
});

// ── percentile math (report numbers must not lie) ───────────────────────────

// ── run-3 fix: JST additions vs corruption split; suffixed Strong's nos ─────

test('JST dangling check splits additions (beyond chapter end) from corruption', () => {
	assert.match(JST_DANGLING_SPLIT_SQL, /vnum > cm\.mx/); // additions branch
	assert.match(JST_DANGLING_SPLIT_SQL, /vnum <= cm\.mx/); // corruption branch
	assert.equal(assertReadOnly(JST_DANGLING_SPLIT_SQL), JST_DANGLING_SPLIT_SQL);
});

test('Strongs pattern accepts suffixes to probed depth F, rejects garbage', () => {
	const re = new RegExp(STRONGS_NO_PATTERN);
	for (const ok of ['H1', 'G5330', 'H1004A', 'H1004B', 'H5526F', 'H2416E']) assert.match(ok, re);
	for (const bad of ['X99', 'H', '1234', 'H12a', 'H1004AB', 'H1004G']) {
		assert.doesNotMatch(bad, re, bad);
	}
});

// ── run-2 fix: EMAXCONNSESSION at 16 clients — session-mode pooler caps at
// pool_size 15; ladder must fit inside it and classify cap rejections apart ──

test('ladder peak stays inside the probed pooler session cap', () => {
	const peak = Math.max(...RUNGS) + 2 + 1; // storm + holders + control
	assert.ok(peak <= POOLER_SESSION_CAP, `peak ${peak} exceeds cap ${POOLER_SESSION_CAP}`);
});

test('pool-cap rejections classify apart from query errors and timeouts', () => {
	assert.equal(classifyError('(EMAXCONNSESSION) max clients reached in session mode'), 'pool-cap');
	assert.equal(classifyError('canceling statement due to statement timeout'), 'timeout');
	assert.equal(classifyError('column does not exist'), 'query-error');
});

test('pct: empty → null; single-sample; index selection', () => {
	assert.equal(pct([], 95), null);
	assert.equal(pct([42], 50), 42);
	assert.equal(pct([42], 99), 42);
	const s = Array.from({ length: 100 }, (_, i) => i + 1); // 1..100
	assert.equal(pct(s, 50), 51);
	assert.equal(pct(s, 95), 96);
	assert.equal(pct(s, 99), 100);
});

// ── remediation-v2 sweep pins (2026-07-21) — v2 items 2/N2 · 1 · 3 · 6 · 7 ·
// D4. Behavior tests, not string pins (both reviewers flagged regex pins). ──

test('graph verse paging: stable ORDER BY id, integer-guarded, read-only', () => {
	const c = graphVersePageCypher(2 * GRAPH_VERSE_PAGE);
	assert.match(c, /ORDER BY id SKIP 20000 LIMIT 10000/);
	assert.equal(assertReadOnly(c), c);
	for (const bad of [['20000'], [1.5], [-1], [0, 0], [0, '10']]) {
		assert.throws(() => graphVersePageCypher(...bad), /invalid paging/, JSON.stringify(bad));
	}
});

test('mapVerseIdsToVolumes: longest book prefix wins, volumes seeded, unknown collected', () => {
	const books = [
		{ id: 'moses', volume_id: 'pgp' },
		{ id: 'moses-extra', volume_id: 'other' }, // prefix-nested sibling
		{ id: 'dc', volume_id: 'dc' },
		{ id: 'gen', volume_id: 'ot' },
	];
	const { byVolume, unknown } = mapVerseIdsToVolumes(
		['moses-1-1', 'moses-extra-2-3', 'dc-76-22', 'dc-4-2', 'mystery-1-1', 'dc'],
		books,
	);
	// 'moses-extra-2-3' must land on the LONGER prefix, not bleed into pgp
	assert.deepEqual(byVolume, { pgp: 1, other: 1, dc: 2, ot: 0 }); // ot seeded at 0
	assert.deepEqual(unknown, ['mystery-1-1', 'dc']); // bare book id is not a verse
});

test('verse parity is directional — equal-sized diffs never net to parity', () => {
	const { pgOnly, graphOnly } = diffIdSets(
		['gen-1-1', 'dc-4-2', 'dc-76-22'],
		['gen-1-1', 'dc-4-2', 'ghost-1-1'],
	);
	assert.deepEqual(pgOnly, ['dc-76-22']); // PG-not-in-graph
	assert.deepEqual(graphOnly, ['ghost-1-1']); // graph-not-in-PG
	// identical sets are true parity
	const clean = diffIdSets(['a-1-1'], ['a-1-1']);
	assert.deepEqual(clean, { pgOnly: [], graphOnly: [] });
});

test('phaseb dedupe classifier: only the pinned debt state and the enforced state are non-fail', () => {
	assert.equal(classifyPhasebDedupe(PHASEB_DUP_PIN, false), 'baseline-debt'); // today
	assert.equal(classifyPhasebDedupe(0, true), 'pass'); // item 3 shipped
	assert.equal(classifyPhasebDedupe(0, false), 'fail'); // dups gone, no index = half-applied
	assert.equal(classifyPhasebDedupe(PHASEB_DUP_PIN, true), 'fail'); // index without merge
	assert.equal(classifyPhasebDedupe(1577, false), 'fail'); // pin drift
	assert.equal(classifyPhasebDedupe(3, true), 'fail'); // new dups past the index
});

test('id-name inventory pin: exactly 311 is debt, ANY other value fails', () => {
	assert.equal(classifyIdNameInventory(ID_NAME_MISMATCH_PIN), 'baseline-debt');
	assert.equal(ID_NAME_MISMATCH_PIN, 311);
	for (const drift of [310, 312, 0]) assert.equal(classifyIdNameInventory(drift), 'fail', String(drift));
});

const D4_ROW = {
	from_id: 'dc', to_id: 'dc', rel_type: 'IN_VOLUME', collection_id: 'phase-b',
	metadata: { from_label: 'LM_Book', to_label: 'LM_Volume' },
};

test('self-loop identity pin: exactly the D4 row is debt; anything else fails', () => {
	assert.equal(classifySelfLoopRows([D4_ROW]), 'baseline-debt');
	// metadata arriving as a JSON string still classifies
	assert.equal(classifySelfLoopRows([{ ...D4_ROW, metadata: JSON.stringify(D4_ROW.metadata) }]), 'baseline-debt');
	assert.equal(classifySelfLoopRows([]), 'fail'); // disappearance is drift too
	assert.equal(classifySelfLoopRows([D4_ROW, D4_ROW]), 'fail'); // a second loop
	assert.equal(classifySelfLoopRows([{ ...D4_ROW, rel_type: 'CROSS_REF' }]), 'fail');
	assert.equal(classifySelfLoopRows([{ ...D4_ROW, collection_id: 'unshaken' }]), 'fail');
	assert.equal(classifySelfLoopRows([{ ...D4_ROW, metadata: { from_label: 'LM_Volume', to_label: 'LM_Book' } }]), 'fail');
	assert.equal(classifySelfLoopRows([{ ...D4_ROW, metadata: null }]), 'fail');
});

test('diffSchema reports both table directions and column drift, quiet on identity', () => {
	const live = { verses: ['id', 'text', 'chapter_id'], words: ['id', 'surface'], roles: ['slug'] };
	const driz = { verses: ['id', 'text', 'chapter_number'], words: ['id', 'surface'], search_index: ['kind'] };
	const d = diffSchema(live, driz);
	assert.deepEqual(d.tables_only_live, ['roles']);
	assert.deepEqual(d.tables_only_drizzle, ['search_index']);
	assert.deepEqual(d.column_mismatches, [
		{ table: 'verses', only_live: ['chapter_id'], only_drizzle: ['chapter_number'] },
	]); // words identical → absent
});

test('drizzleTableMap extracts the REAL schema defs (live diff gets real input)', () => {
	const map = drizzleTableMap();
	for (const t of ['verses', 'words', 'collections', 'entities', 'edges', 'transcripts', 'search_index']) {
		assert.ok(map[t]?.length, t);
	}
	assert.ok(!('lumen' in map), 'the pgSchema export is not a table');
	assert.ok(map.words.includes('surface_form'), 'known drift marker (live column is surface)');
	assert.ok(map.verses.includes('volume_id'));
	for (const cols of Object.values(map)) assert.deepEqual(cols, [...cols].sort());
});

test('sweep pin SQL/Cypher stays read-only and matches the session probes', () => {
	for (const text of [
		PHASEB_DUP_GROUPS_SQL, PHASEB_INDEX_PRESENT_SQL, ID_NAME_MISMATCH_SQL,
		SELF_LOOP_ROWS_SQL, TWO_HOP_DC_76_22_CYPHER,
	]) {
		assert.equal(assertReadOnly(text), text);
	}
	assert.match(ID_NAME_MISMATCH_SQL, /split_part\(slug, '-', 1\)/); // exact probe semantics
	assert.match(ID_NAME_MISMATCH_SQL, /'phase-b'/);
	assert.match(ID_NAME_MISMATCH_SQL, /'person','place'/);
	assert.match(TWO_HOP_DC_76_22_CYPHER, /dc-76-22/);
	assert.match(SELF_LOOP_ROWS_SQL, /from_id = to_id/);
	assert.match(PHASEB_INDEX_PRESENT_SQL, /idx_edges_phaseb_unique/);
	assert.match(PHASEB_DUP_GROUPS_SQL, /collection_id = 'phase-b'/);
});

// ── run-4 fix: phase-scoped rerun clobbered the other phase's results ───────

test('mergeResults never clobbers the other phase', async () => {
	const { mergeResults } = await import('../stress-test-data.mjs');
	const existing = { integrity: [{ dim: 'I1' }], load: { rungs: [1, 2] } };
	const integrityOnly = { integrity: [{ dim: 'I2' }], load: null, startedAt: 'x' };
	const merged = mergeResults(existing, integrityOnly);
	assert.deepEqual(merged.load, { rungs: [1, 2] }); // preserved
	assert.deepEqual(merged.integrity, [{ dim: 'I2' }]); // replaced
	const loadOnly = { integrity: [], load: { rungs: [3] } };
	const merged2 = mergeResults(existing, loadOnly);
	assert.deepEqual(merged2.integrity, [{ dim: 'I1' }]); // preserved
	assert.deepEqual(merged2.load, { rungs: [3] });
});
