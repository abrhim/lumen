// Item 4 (JST placement stamping, per D1) — unit pins. No DB: pure helpers
// exercised behaviorally; SQL consts pinned against the harness split they
// must mirror. Importing the migration module opens no connection (main is
// argv-guarded) — these tests running at all proves that.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
	EXPECTED_TARGETS,
	PLACEMENT,
	anchorVerseId,
	splitDangling,
	buildEscrow,
	JST_TARGET_ROWS_SQL,
	JST_STAMP_UPDATE_SQL,
	STAMPED_WITHOUT_ANCHOR_SQL,
	POST_UNANCHORED_SQL,
	ANCHOR_RESOLVES_SQL,
} from '../migrate-jst-placement.mjs';
import { JST_DANGLING_SPLIT_SQL } from '../stress-test-data.mjs';

const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ── plan pins ───────────────────────────────────────────────────────────────

test('target count is pinned to the remediation plan (427) and placement to D1', () => {
	assert.equal(EXPECTED_TARGETS, 427);
	assert.equal(PLACEMENT, 'beyond_canon_end');
});

// ── anchorVerseId ───────────────────────────────────────────────────────────

test('anchorVerseId: Gen 1 max 31 -> gen-1-31 (the jst-gen-1-32 anchor)', () => {
	assert.equal(anchorVerseId('gen-1', 31), 'gen-1-31');
	assert.equal(anchorVerseId('moses-1', 42), 'moses-1-42');
	assert.equal(anchorVerseId('gen-1', '31'), 'gen-1-31'); // pg text-mode int
});

test('anchorVerseId refuses to mint an anchor from bad input', () => {
	for (const [chap, mx] of [
		[null, 31], ['', 31], [42, 31],
		['gen-1', null], ['gen-1', undefined], ['gen-1', 0], ['gen-1', -3],
		['gen-1', 1.5], ['gen-1', NaN], ['gen-1', 'x'],
	]) {
		assert.throws(() => anchorVerseId(chap, mx), /anchorVerseId/, `chap=${chap} mx=${mx}`);
	}
});

test('anchorVerseId agrees with the SQL derivation (chap || - || mx::text)', () => {
	const chap = 'gen-1';
	const mx = 31;
	assert.equal(anchorVerseId(chap, mx), `${chap}-${String(mx)}`);
	assert.match(norm(JST_STAMP_UPDATE_SQL), /'anchor_verse_id', t\.chap \|\| '-' \|\| t\.mx::text/);
});

// ── splitDangling (mirrors the harness additions/corrupt split) ─────────────

test('splitDangling: jst-gen-1-32 (Gen 1 max 31) classifies as addition, anchors to gen-1-31', () => {
	const row = { id: 'jst-gen-1-32', vid: 'gen-1-32', chap: 'gen-1', vnum: 32, mx: 31 };
	const { additions, corrupt } = splitDangling([row]);
	assert.deepEqual(additions, [row]);
	assert.deepEqual(corrupt, []);
	assert.equal(anchorVerseId(row.chap, row.mx), 'gen-1-31');
});

test('splitDangling: dangling-but-within-canon is CORRUPTION, not an addition', () => {
	// gen-1-15 with Gen 1 max 31: the verse_id SHOULD resolve — dangling here
	// means real corruption; item 4 must abort exit 2 on any such row.
	const row = { id: 'jst-gen-1-15', vid: 'gen-1-15', chap: 'gen-1', vnum: 15, mx: 31 };
	const { additions, corrupt } = splitDangling([row]);
	assert.deepEqual(additions, []);
	assert.deepEqual(corrupt, [row]);
});

test('splitDangling truth table matches the SQL split, stricter on NULLs', () => {
	const rows = [
		{ id: 'a', vnum: 32, mx: 31 }, // beyond end -> addition
		{ id: 'b', vnum: 15, mx: 31 }, // within range -> corrupt
		{ id: 'c', vnum: 31, mx: 31 }, // boundary equal -> corrupt (not beyond)
		{ id: 'd', vnum: 4, mx: null }, // unknown chapter -> corrupt (mx IS NULL branch)
		{ id: 'e', vnum: null, mx: 31 }, // unparseable verse num -> corrupt (SQL counts it in NEITHER filter; the total gate catches it, the classifier hard-fails it)
		{ id: 'f', vnum: '32', mx: '31' }, // pg text-mode strings -> addition
	];
	const { additions, corrupt } = splitDangling(rows);
	assert.deepEqual(additions.map((r) => r.id), ['a', 'f']);
	assert.deepEqual(corrupt.map((r) => r.id), ['b', 'c', 'd', 'e']);
	assert.equal(additions.length + corrupt.length, rows.length); // no classification hole
});

// ── buildEscrow ─────────────────────────────────────────────────────────────

test('buildEscrow demands the exact expected count and restore-capable images', () => {
	const row = (id) => ({
		id, vid: 'gen-1-32', chap: 'gen-1', vnum: 32, mx: 31,
		row_image: { id, entity_type: 'jst_reading', metadata: { verse_id: 'gen-1-32' } },
	});
	const doc = buildEscrow([row('x'), row('y')], { expected: 2, createdAt: 'T' });
	assert.equal(doc.count, 2);
	assert.equal(doc.expected, 2);
	assert.equal(doc.created_at, 'T');
	assert.deepEqual(doc.rows.map((r) => r.id), ['x', 'y']);
	assert.match(doc.restore_hint, /PK id/);
	assert.throws(() => buildEscrow([row('x')], { expected: 2 }), /count 1 != expected 2/);
	assert.throws(() => buildEscrow([{ id: 'x', row_image: null }], { expected: 1 }), /row_image/);
	assert.throws(() => buildEscrow([{ id: 'x', row_image: { id: 'x' } }], { expected: 1 }), /metadata/);
	assert.throws(() => buildEscrow([row('x')], {}), /expected count required/);
});

// ── SQL consts: mirror + stamping shape ─────────────────────────────────────

test('row/update/post SQL mirror the harness split CTEs verbatim', () => {
	const CHAPMAX = norm(`chapmax AS (
		SELECT chapter_id, max((regexp_match(id, '-([0-9]+)$'))[1]::int) mx
		FROM lumen.verses GROUP BY 1)`);
	for (const [name, text] of [
		['harness', JST_DANGLING_SPLIT_SQL],
		['targets', JST_TARGET_ROWS_SQL],
		['update', JST_STAMP_UPDATE_SQL],
		['post_unanchored', POST_UNANCHORED_SQL],
	]) {
		const n = norm(text);
		assert.ok(n.includes(`e.collection_id = 'jst' AND v.id IS NULL`), `${name}: dangling predicate`);
		assert.ok(n.includes(`LEFT JOIN lumen.verses v ON v.id = e.metadata->>'verse_id'`), `${name}: verse resolution`);
		assert.ok(n.includes(`regexp_replace(vid, '-[0-9]+$', '')`), `${name}: chapter parse`);
		assert.ok(n.includes(`(regexp_match(vid, '-([0-9]+)$'))[1]::int`), `${name}: verse-num parse`);
		assert.ok(n.includes(CHAPMAX), `${name}: chapmax CTE`);
	}
});

test('stamp UPDATE merges metadata (jsonb ||) — set, never replace', () => {
	const n = norm(JST_STAMP_UPDATE_SQL);
	assert.ok(n.includes(`SET metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object(`));
	assert.ok(!n.includes('SET metadata = jsonb_build_object'), 'must not replace metadata wholesale');
	assert.ok(n.includes(`'placement', '${PLACEMENT}'`));
	assert.ok(n.includes(`'anchor_verse_id', t.chap || '-' || t.mx::text`));
});

test('stamp UPDATE targets ONLY the additions branch, scoped to jst, and returns the stamp for parity checks', () => {
	const n = norm(JST_STAMP_UPDATE_SQL);
	assert.ok(n.includes('FROM parsed p JOIN chapmax cm ON cm.chapter_id = p.chap'), 'INNER join = mx non-null');
	assert.ok(n.includes('WHERE p.vnum > cm.mx'), 'beyond-chapter-end only');
	assert.ok(n.includes(`WHERE e.id = t.id AND e.collection_id = 'jst'`));
	assert.ok(n.includes(`RETURNING e.id, e.metadata->>'placement' placement, e.metadata->>'anchor_verse_id' anchor`));
});

test('in-tx invariant SQL pins the exact spec conditions', () => {
	const s1 = norm(STAMPED_WITHOUT_ANCHOR_SQL);
	assert.ok(s1.includes(`metadata->>'placement' = '${PLACEMENT}'`));
	assert.ok(s1.includes(`nullif(metadata->>'anchor_verse_id', '') IS NULL`));
	assert.ok(s1.includes(`collection_id = 'jst'`));
	const s2 = norm(POST_UNANCHORED_SQL);
	assert.ok(s2.includes('WHERE p.vnum > cm.mx'), 'unanchored-dangler count scoped to the additions branch');
	assert.ok(s2.includes(`p.meta->>'placement' IS DISTINCT FROM '${PLACEMENT}'`));
	assert.ok(s2.includes(`nullif(p.meta->>'anchor_verse_id', '') IS NULL`));
	const s3 = norm(ANCHOR_RESOLVES_SQL);
	assert.ok(s3.includes(`e.collection_id = 'jst'`));
	assert.ok(s3.includes(`NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.metadata->>'anchor_verse_id')`));
});

test('escrow query carries full row images and deterministic order', () => {
	const n = norm(JST_TARGET_ROWS_SQL);
	assert.ok(n.includes('to_jsonb(e) row_image'), 'full-row image, all columns');
	assert.ok(n.includes('ORDER BY p.id'), 'deterministic escrow + samples');
});
