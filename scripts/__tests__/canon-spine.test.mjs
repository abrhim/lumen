// Harness (canon-spine): migration derivation + verification pure functions.
// Run: node --test scripts/__tests__/canon-spine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveChapters, diffQueryParity, SPINE_DDL, p4Preflight } from '../migrate-canon-spine.mjs';
import { planWordBatches } from '../ingest-words.mjs';

test('deriveChapters builds chapter rows from verse ground truth (FM-3)', () => {
  const verses = [
    { book_id: '1-ne', chapter_number: 1, verse_number: 1 },
    { book_id: '1-ne', chapter_number: 1, verse_number: 2 },
    { book_id: '1-ne', chapter_number: 2, verse_number: 1 },
    { book_id: 'dc', chapter_number: 4, verse_number: 1 },
  ];
  const chapters = deriveChapters(verses);
  assert.deepEqual(chapters, [
    { id: '1-ne-1', book_id: '1-ne', number: 1, verse_count: 2 },
    { id: '1-ne-2', book_id: '1-ne', number: 2, verse_count: 1 },
    { id: 'dc-4', book_id: 'dc', number: 4, verse_count: 1 },
  ]);
});

test('diffQueryParity reports row-level differences, empty when identical (FM-6)', () => {
  const a = [{ id: 'x', n: 1 }, { id: 'y', n: 2 }];
  const same = diffQueryParity(a, [{ id: 'x', n: 1 }, { id: 'y', n: 2 }]);
  assert.equal(same.length, 0);
  const diff = diffQueryParity(a, [{ id: 'x', n: 1 }, { id: 'y', n: 3 }]);
  assert.equal(diff.length, 1);
});

test('diffQueryParity is key-based: permuted-but-equal rows are parity, not false positives (COR-4)', () => {
  const a = [{ id: 'x', n: 1 }, { id: 'y', n: 2 }, { id: 'z', n: 3 }];
  const permuted = [{ id: 'z', n: 3 }, { id: 'x', n: 1 }, { id: 'y', n: 2 }];
  assert.equal(diffQueryParity(a, permuted).length, 0);
  // missing + extra rows both surface
  const missing = diffQueryParity(a, [{ id: 'x', n: 1 }]);
  assert.equal(missing.length, 2);
});

test('SPINE_DDL never drops tables — a P1 re-run must not destroy ingested words (B1/CMIG-1)', () => {
  assert.equal(/DROP TABLE/i.test(SPINE_DDL), false);
  assert.match(SPINE_DDL, /CREATE TABLE IF NOT EXISTS lumen\.words/);
});

test('SPINE_DDL applies the RLS convention to words like every sibling table (B2/CSEC-1)', () => {
  assert.match(SPINE_DDL, /ALTER TABLE lumen\.words ENABLE ROW LEVEL SECURITY/);
  assert.match(SPINE_DDL, /CREATE POLICY words_read ON lumen\.words FOR SELECT USING \(true\)/);
});

test('SPINE_DDL grants lumen_read the spine tables but not migration_state (B20/CSEC-2)', () => {
  const grant = SPINE_DDL.match(/^GRANT SELECT ON (.+) TO lumen_read;$/m)?.[1] ?? '';
  assert.match(grant, /lumen\.words/);
  assert.doesNotMatch(grant, /migration_state/);
});

test('SPINE_DDL defers the words search index to post-bulk-load (B17/CPERF-7)', () => {
  assert.doesNotMatch(SPINE_DDL, /CREATE INDEX[^;]*ON lumen\.words/);
});

test('p4Preflight requires BOTH --confirm and the P3 marker (B5/CMIG-2)', () => {
  const marker = [{ value: {} }];
  assert.equal(p4Preflight(['node', 'x', '--drop-transition-columns'], marker).ok, false);
  assert.equal(p4Preflight(['node', 'x', '--drop-transition-columns', '--confirm'], []).ok, false);
  assert.equal(p4Preflight(['node', 'x', '--drop-transition-columns', '--confirm'], marker).ok, true);
  // refusal reasons name the missing gate
  assert.match(p4Preflight(['node', 'x'], marker).reason, /--confirm/);
  assert.match(p4Preflight(['node', 'x', '--confirm'], []).reason, /smoke-canon-spine/);
});

test('planWordBatches is idempotent-friendly: batches keyed by verse, re-planning converges (FM-8)', () => {
  const verses = Array.from({ length: 2500 }, (_, i) => ({ id: `v-${i}`, text: 'a b c' }));
  const batches = planWordBatches(verses, 1000);
  assert.equal(batches.length, 3);
  assert.equal(batches.flat().length, 2500);
  // re-planning the tail after an interrupt yields the same remaining work
  const resumed = planWordBatches(verses.slice(2000), 1000);
  assert.equal(resumed.flat().length, 500);
});
