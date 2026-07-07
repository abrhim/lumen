// Harness (tske-cross-references): ingest pure functions.
// Run: node --test scripts/__tests__/openbible.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEdgeRows } from '../ingest-openbible-refs.mjs';

const lookup = (chapterId) => (chapterId === 'ps-148' ? 14 : chapterId === 'gen-1' ? 31 : null);

test('buildEdgeRows: plain pair → one edge with votes metadata (FM-3/FM-4)', () => {
  const { rows, unmapped } = buildEdgeRows(
    [['Gen.1.1', 'Heb.11.3', '271']],
    (id) => (id === 'heb-11' ? 40 : id === 'gen-1' ? 31 : null),
  );
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

test('buildEdgeRows: unmappable refs are reported, not thrown, not silently dropped (FM-3)', () => {
  const { rows, unmapped } = buildEdgeRows(
    [['Tob.1.1', 'Gen.1.1', '5'], ['Gen.1.1', 'Gen.1.2', '7']],
    lookup,
  );
  assert.equal(rows.length, 1);
  assert.equal(unmapped.length, 1);
  assert.match(unmapped[0], /Tob/);
});

test('buildEdgeRows: negative votes are kept (Q4 default: rank last, never drop)', () => {
  const { rows } = buildEdgeRows([['Gen.1.1', 'Gen.1.2', '-3']], lookup);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].metadata.votes, -3);
});
