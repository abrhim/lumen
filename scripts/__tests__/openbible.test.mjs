// Harness (tske-cross-references): ingest pure functions.
// Run: node --import tsx --test scripts/__tests__/openbible.test.mjs
// (tsx loader needed: the row builder delegates OSIS parsing to the
// TypeScript osis-map module, injected via _setOsisModule.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as osis from '../../packages/scripture/src/osis-map.ts';
import {
  buildEdgeRows,
  dedupeEdgeRows,
  VERSIFICATION_EXCEPTIONS,
  _setOsisModule,
} from '../ingest-openbible-refs.mjs';

_setOsisModule(osis);

const lookup = (chapterId) =>
  ({ 'ps-148': 14, 'gen-1': 31, 'heb-11': 40, 'lev-27': 34, 'num-1': 54, '3-jn-1': 14, 'rev-13': 18 })[chapterId] ?? null;

test('buildEdgeRows: plain pair → one edge with votes metadata (FM-3/FM-4)', () => {
  const { rows, unmapped } = buildEdgeRows([['Gen.1.1', 'Heb.11.3', '271']], lookup);
  assert.equal(unmapped.length, 0);
  assert.deepEqual(rows, [{
    from_id: 'gen-1-1', to_id: 'heb-11-3',
    metadata: { votes: 271, range_start: null, range_end: null },
  }]);
});

test('buildEdgeRows: range expands to one edge per verse sharing the range group (FM-4/FM-5)', () => {
  const { rows } = buildEdgeRows([['Gen.1.1', 'Ps.148.4-Ps.148.5', '59']], lookup);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.to_id), ['ps-148-4', 'ps-148-5']);
  for (const r of rows) {
    assert.equal(r.metadata.range_start, 'ps-148-4');
    assert.equal(r.metadata.range_end, 'ps-148-5');
    assert.equal(r.metadata.votes, 59);
  }
});

test('buildEdgeRows: cross-BOOK range rolls over via nextChapter (COR-4, live Lev→Num case)', () => {
  const next = (id) => (id === 'lev-27' ? 'num-1' : null);
  const { rows, unmapped } = buildEdgeRows([['Gen.1.1', 'Lev.27.34-Num.1.1', '7']], lookup, next);
  assert.equal(unmapped.length, 0);
  assert.deepEqual(rows.map((r) => r.to_id), ['lev-27-34', 'num-1-1']);
});

test('buildEdgeRows: unmappable refs are reported, not thrown, not silently dropped (FM-3)', () => {
  const { rows, unmapped } = buildEdgeRows(
    [['Tob.1.1', 'Gen.1.1', '5'], ['Gen.1.1', 'Gen.1.2', '7']],
    lookup,
  );
  assert.equal(rows.length, 1);
  assert.equal(unmapped.length, 1);
  assert.match(unmapped[0], /Tob/);
});

test('buildEdgeRows: negative votes are kept (Q4: rank last, never drop)', () => {
  const { rows } = buildEdgeRows([['Gen.1.1', 'Gen.1.2', '-3']], lookup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metadata.votes, -3);
});

test('buildEdgeRows: versification exceptions rewrite known drift refs (Q8/COR-1)', () => {
  assert.equal(VERSIFICATION_EXCEPTIONS['3John.1.15'], '3John.1.14');
  const { rows, unmapped } = buildEdgeRows([['Gen.1.1', '3John.1.15', '4']], lookup);
  assert.equal(unmapped.length, 0);
  assert.equal(rows[0].to_id, '3-jn-1-14');
  const rev = buildEdgeRows([['Rev.12.18', 'Gen.1.1', '4']], lookup);
  assert.equal(rev.rows[0].from_id, 'rev-13-1');
});

test('buildEdgeRows: out-of-chapter verse numbers are unmapped, never clamped (COR-1)', () => {
  const { rows, unmapped } = buildEdgeRows([['Gen.1.99', 'Gen.1.1', '4']], lookup);
  assert.equal(rows.length, 0);
  assert.equal(unmapped.length, 1);
});

test('dedupeEdgeRows: self-refs dropped, duplicate pairs keep max votes (DATA-2/DATA-4)', () => {
  const meta = (votes) => ({ votes, range_start: null, range_end: null });
  const { rows, selfRefs, duplicates } = dedupeEdgeRows([
    { from_id: 'a', to_id: 'a', metadata: meta(9) },
    { from_id: 'a', to_id: 'b', metadata: meta(3) },
    { from_id: 'a', to_id: 'b', metadata: meta(8) },
    { from_id: 'b', to_id: 'a', metadata: meta(1) },
  ]);
  assert.equal(selfRefs, 1);
  assert.equal(duplicates, 1);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.from_id === 'a' && r.to_id === 'b').metadata.votes, 8);
});
