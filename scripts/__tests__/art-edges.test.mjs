// Harness (art-graph): edge materialization pure functions.
// Run: node --test scripts/__tests__/art-edges.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtEdges, ART_PERSON_MAP } from '../materialize-art-edges.mjs';

const artwork = (o = {}) => ({
  id: 'art:nativity-test',
  metadata: {
    refs: [{ book_id: 'luke', chapter: 2, verse_start: null, verse_end: null, is_primary: true }],
    biblical_character: [],
    ...o,
  },
});

const chapterExists = (id) => ['luke-2', 'john-3', 'gen-1'].includes(id);
const verseExists = (id) => /^luke-2-(\d|1[0-4])$/.test(id) || id === 'john-3-16';
const personExists = (id) => ['jesus-christ', 'mary-1', 'moses-1'].includes(id);

test('chapter ref → one DEPICTS edge to the spine chapter id (FM-1)', () => {
  const { edges, skipped } = buildArtEdges([artwork()], { chapterExists, verseExists, personExists });
  assert.equal(skipped.length, 0);
  assert.deepEqual(edges, [{
    from_id: 'art:nativity-test', to_id: 'luke-2', rel_type: 'DEPICTS',
    metadata: { is_primary: true, range_start: null, range_end: null },
  }]);
});

test('verse-range ref → chapter edge PLUS one verse edge per verse with range metadata (FM-2/Q4)', () => {
  const { edges } = buildArtEdges(
    [artwork({ refs: [{ book_id: 'luke', chapter: 2, verse_start: 8, verse_end: 14, is_primary: false }] })],
    { chapterExists, verseExists, personExists },
  );
  const verseEdges = edges.filter((e) => e.to_id.split('-').length === 3);
  assert.equal(verseEdges.length, 7); // 8..14 inclusive
  assert.equal(verseEdges[0].to_id, 'luke-2-8');
  assert.equal(verseEdges[6].to_id, 'luke-2-14');
  for (const e of verseEdges) {
    assert.equal(e.metadata.range_start, 'luke-2-8');
    assert.equal(e.metadata.range_end, 'luke-2-14');
  }
  assert.ok(edges.some((e) => e.to_id === 'luke-2' && e.rel_type === 'DEPICTS'));
});

test('character slugs map through ART_PERSON_MAP to FEATURES edges; unmapped slugs are reported (FM-3/Q3)', () => {
  assert.equal(ART_PERSON_MAP['jesus'], 'jesus-christ');
  assert.equal(ART_PERSON_MAP['john_baptist'], 'john-the-baptist-1');
  const { edges, unmappedSlugs } = buildArtEdges(
    [artwork({ biblical_character: ['jesus', 'zzz_unknown_slug'] })],
    { chapterExists, verseExists, personExists },
  );
  assert.ok(edges.some((e) => e.rel_type === 'FEATURES' && e.to_id === 'jesus-christ'));
  assert.deepEqual(unmappedSlugs, ['zzz_unknown_slug']);
});

test('invalid chapter refs are skipped and counted, never guessed (FM-1)', () => {
  const { edges, skipped } = buildArtEdges(
    [artwork({ refs: [{ book_id: 'tobit', chapter: 1, verse_start: null, verse_end: null }] })],
    { chapterExists, verseExists, personExists },
  );
  assert.equal(edges.length, 0);
  assert.equal(skipped.length, 1);
});

test('duplicate refs dedupe to one edge per (from, to, rel_type) (FM-4)', () => {
  const { edges } = buildArtEdges(
    [artwork({ refs: [
      { book_id: 'luke', chapter: 2, verse_start: null, verse_end: null, is_primary: true },
      { book_id: 'luke', chapter: 2, verse_start: null, verse_end: null, is_primary: false },
    ] })],
    { chapterExists, verseExists, personExists },
  );
  assert.equal(edges.filter((e) => e.to_id === 'luke-2').length, 1);
  assert.equal(edges[0].metadata.is_primary, true); // primary wins the merge
});
