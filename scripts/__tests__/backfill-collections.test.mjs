// Harness for the backfill's join/reconcile logic (plan FM-9, COR-8, DATA-1/2).
// Run: node --test scripts/__tests__/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveGraphId,
  chunk,
  findConflictingEdgeRows,
  partitionEdgeRows,
  reconcile,
  scrub,
  VERIFY_NODE_PAGE_QUERY,
  VERIFY_EDGE_PAGE_QUERY,
} from '../backfill-neo4j-collections.mjs';

test('B11: conflicting edge rows are EXCLUDED from the stampable set, not last-write-wins', () => {
  const rows = [
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'phase-b' },
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'canon' },
    { from: 'x', to: 'y', rel_type: 'TEACHES', cid: 'phase-b' },
  ];
  const { clean, conflicts } = partitionEdgeRows(rows);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(clean, [{ from: 'x', to: 'y', rel_type: 'TEACHES', cid: 'phase-b' }]);
});

test('B13: verify pagination is ORDER BY-stable', () => {
  assert.match(VERIFY_NODE_PAGE_QUERY(0), /ORDER BY id SKIP/);
  assert.match(VERIFY_EDGE_PAGE_QUERY(10000), /ORDER BY elementId\(r\) SKIP 10000/);
});

test('B20: scrub strips credentials from connection strings and password params', () => {
  assert.equal(
    scrub('connect failed: postgresql://user:s3cret@db.host:5432/postgres'),
    'connect failed: postgresql://<redacted>@db.host:5432/postgres',
  );
  assert.equal(scrub('neo4j+s://abc:pw@x.databases.neo4j.io'), 'neo4j+s://<redacted>@x.databases.neo4j.io');
  assert.equal(scrub('retry with password=hunter2&ssl=on'), 'retry with password=<redacted>&ssl=on');
  assert.equal(scrub('plain message'), 'plain message');
});

test('resolveGraphId prefers metadata.neo4j_id for namespaced phase-b entities (DATA-2)', () => {
  assert.equal(resolveGraphId('person:nephi-1', { neo4j_id: 'nephi-1' }), 'nephi-1');
  assert.equal(resolveGraphId('obedience', { neo4j_id: null }), 'obedience');
  assert.equal(resolveGraphId('obedience', {}), 'obedience');
  assert.equal(resolveGraphId('obedience', undefined), 'obedience');
});

test('findConflictingEdgeRows flags same-key rows that disagree, not agreeing duplicates (DATA-1)', () => {
  const agree = [
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'phase-b' },
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'phase-b' },
  ];
  assert.equal(findConflictingEdgeRows(agree).length, 0);
  const disagree = [
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'phase-b' },
    { from: 'a', to: 'b', rel_type: 'CROSS_REF', cid: 'canon' },
  ];
  assert.equal(findConflictingEdgeRows(disagree).length, 1);
});

test('chunk covers every row exactly once', () => {
  const rows = Array.from({ length: 4501 }, (_, i) => i);
  const batches = chunk(rows, 2000);
  assert.equal(batches.length, 3);
  assert.equal(batches.flat().length, 4501);
});

test('reconcile classifies unstamped / mismatched / orphans (--verify contract)', () => {
  const desired = new Map([['a', 'canon'], ['b', 'phase-b'], ['c', 'jst']]);
  const observed = new Map([['a', null], ['b', 'strongs'], ['x', 'phase-b']]);
  const diff = reconcile(desired, observed);
  assert.deepEqual(diff.pending, ['a']);
  assert.deepEqual(diff.mismatched, [{ id: 'b', expected: 'phase-b', actual: 'strongs' }]);
  assert.deepEqual(diff.orphans, ['x']);
});

test('interrupted run converges: stamping the pending remainder yields a clean reconcile (COR-8/FM-9)', () => {
  const desired = new Map([['a', 'canon'], ['b', 'canon'], ['c', 'canon'], ['d', 'canon']]);
  // crash after stamping half
  const store = new Map([['a', 'canon'], ['b', 'canon'], ['c', null], ['d', null]]);
  const firstDiff = reconcile(desired, store);
  assert.deepEqual(firstDiff.pending, ['c', 'd']);
  // resume: stamp only the pending remainder (idempotent SET)
  for (const id of firstDiff.pending) store.set(id, desired.get(id));
  const secondDiff = reconcile(desired, store);
  assert.equal(secondDiff.pending.length, 0);
  assert.equal(secondDiff.mismatched.length, 0);
  // a second full re-run changes nothing (idempotency)
  for (const [id, cid] of desired) store.set(id, cid);
  const thirdDiff = reconcile(desired, store);
  assert.equal(thirdDiff.pending.length + thirdDiff.mismatched.length, 0);
});
