// Harness (canon-spine): migration derivation + verification pure functions.
// Run: node --test scripts/__tests__/canon-spine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveChapters, diffQueryParity } from '../migrate-canon-spine.mjs';
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

test('planWordBatches is idempotent-friendly: batches keyed by verse, re-planning converges (FM-8)', () => {
  const verses = Array.from({ length: 2500 }, (_, i) => ({ id: `v-${i}`, text: 'a b c' }));
  const batches = planWordBatches(verses, 1000);
  assert.equal(batches.length, 3);
  assert.equal(batches.flat().length, 2500);
  // re-planning the tail after an interrupt yields the same remaining work
  const resumed = planWordBatches(verses.slice(2000), 1000);
  assert.equal(resumed.flat().length, 500);
});
