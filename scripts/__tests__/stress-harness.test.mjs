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
