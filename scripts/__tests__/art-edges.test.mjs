// Harness (art-graph): edge materialization pure functions.
// Run: node --test scripts/__tests__/art-edges.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArtEdges, ART_PERSON_MAP, ART_PERSON_BOOK_GATE } from '../materialize-art-edges.mjs';

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

test('ART_PERSON_MAP values all exist in the live person-id snapshot (FM-3/API-2, probed 2026-07-07)', () => {
  const LIVE_PERSON_IDS = new Set([
    'jesus-christ', 'david-1', 'jacob-patriarch-1', 'person:moses-1',
    'john-the-baptist-1', 'abraham-1', 'judas-iscariot-1', 'mary-1',
    'mary-magdalene-1', 'elijah-tishbite', 'person:job-1', 'solomon-1',
    'peter-1', 'esther-1', 'person:jonah-1', 'paul-1', 'isaac-1', 'eve-1',
    'person:ruth-1', 'adam-1', 'samson-1',
  ]);
  for (const [slug, personId] of Object.entries(ART_PERSON_MAP)) {
    assert.ok(LIVE_PERSON_IDS.has(personId), `${slug} → ${personId} not in the live snapshot`);
  }
  // ambiguous slugs stay deliberately unmapped (amendment 6)
  for (const slug of ['joseph', 'noah', 'daniel']) {
    assert.equal(ART_PERSON_MAP[slug], undefined, `${slug} must remain unmapped`);
  }
});

test('single-verse cite (verse_end null) → chapter edge + ONE verse edge, no range metadata (COR-1)', () => {
  const chapterExists = (id) => id === 'john-3';
  const verseExists = (id) => id === 'john-3-16';
  const { edges, skipped } = buildArtEdges(
    [{ id: 'art:x', metadata: { refs: [{ book_id: 'john', chapter: 3, verse_start: 16, verse_end: null }], biblical_character: [] } }],
    { chapterExists, verseExists, personExists: () => false },
  );
  assert.equal(skipped.length, 0);
  const verseEdges = edges.filter((e) => e.to_id === 'john-3-16');
  assert.equal(verseEdges.length, 1);
  assert.equal(verseEdges[0].metadata.range_start, null);
});

test('out-of-range verses in a VALID chapter: chapter edge kept, verses PARTIAL-skipped, never guessed (COR-4/SEC-3/CCD-3)', () => {
  const chapterExists = (id) => id === 'john-3';
  const verseExists = (id) => /^john-3-(\d|1\d|2\d|3[0-6])$/.test(id); // john 3 has 36 verses
  const { edges, skipped, partial } = buildArtEdges(
    [{ id: 'art:x', metadata: { refs: [{ book_id: 'john', chapter: 3, verse_start: 35, verse_end: 40 }], biblical_character: [] } }],
    { chapterExists, verseExists, personExists: () => false },
  );
  assert.equal(edges.filter((e) => e.to_id.startsWith('john-3-')).length, 0);
  assert.ok(edges.some((e) => e.to_id === 'john-3')); // the chapter anchor survives
  assert.equal(skipped.length, 0); // whole-ref cap unaffected
  assert.equal(partial.length, 1);
  assert.match(partial[0], /verse bounds/);
});

test('polysemous slugs are book-gated per artwork (CCD-1: judas/jacob live wrong-edge class)', () => {
  assert.deepEqual(ART_PERSON_BOOK_GATE.judas, ['matt', 'mark', 'luke', 'john', 'acts']);
  const lookups = {
    chapterExists: (id) => ['matt-26', 'ex-14', 'gen-32'].includes(id),
    verseExists: () => true,
    personExists: () => true,
  };
  // Judas Maccabeus-style work (no NT ref) → context-skipped, no FEATURES
  const macc = buildArtEdges(
    [{ id: 'art:maccabeus', metadata: { refs: [{ book_id: 'ex', chapter: 14, verse_start: null, verse_end: null }], biblical_character: ['judas'] } }],
    lookups,
  );
  assert.equal(macc.edges.filter((e) => e.rel_type === 'FEATURES').length, 0);
  assert.deepEqual(macc.contextSkipped, ['art:maccabeus:judas']);
  // Gospel-anchored judas → mapped
  const gospel = buildArtEdges(
    [{ id: 'art:betrayal', metadata: { refs: [{ book_id: 'matt', chapter: 26, verse_start: null, verse_end: null }], biblical_character: ['judas'] } }],
    lookups,
  );
  assert.ok(gospel.edges.some((e) => e.rel_type === 'FEATURES' && e.to_id === 'judas-iscariot-1'));
  // Genesis jacob → mapped; Exodus "Israel" jacob → context-skipped
  const patriarch = buildArtEdges(
    [{ id: 'art:wrestle', metadata: { refs: [{ book_id: 'gen', chapter: 32, verse_start: null, verse_end: null }], biblical_character: ['jacob'] } }],
    lookups,
  );
  assert.ok(patriarch.edges.some((e) => e.to_id === 'jacob-patriarch-1'));
});

test('every edge in an overlap group carries IDENTICAL range metadata (CCD-2 repro)', () => {
  const chapterExists = (id) => id === 'luke-2';
  const verseExists = (id) => /^luke-2-\d+$/.test(id);
  const { edges } = buildArtEdges(
    [{ id: 'art:x', metadata: { refs: [
      { book_id: 'luke', chapter: 2, verse_start: 8, verse_end: 10 },
      { book_id: 'luke', chapter: 2, verse_start: 9, verse_end: 12 },
    ], biblical_character: [] } }],
    { chapterExists, verseExists, personExists: () => false },
  );
  const verseEdges = edges.filter((e) => e.to_id.startsWith('luke-2-'));
  assert.equal(verseEdges.length, 5); // 8..12, no duplicates
  for (const e of verseEdges) {
    assert.equal(e.metadata.range_start, 'luke-2-8');
    assert.equal(e.metadata.range_end, 'luke-2-12');
  }
});

test('is_primary merge is order-independent; overlapping duplicate verse refs union ranges (COR-5)', () => {
  const chapterExists = (id) => id === 'luke-2';
  const verseExists = (id) => /^luke-2-\d+$/.test(id);
  const mk = (refs) => buildArtEdges(
    [{ id: 'art:x', metadata: { refs, biblical_character: [] } }],
    { chapterExists, verseExists, personExists: () => false },
  ).edges.find((e) => e.to_id === 'luke-2');
  const a = { book_id: 'luke', chapter: 2, verse_start: null, verse_end: null, is_primary: true };
  const b = { book_id: 'luke', chapter: 2, verse_start: null, verse_end: null, is_primary: false };
  assert.equal(mk([a, b]).metadata.is_primary, true);
  assert.equal(mk([b, a]).metadata.is_primary, true); // false-then-true also wins

  const { edges } = buildArtEdges(
    [{ id: 'art:x', metadata: { refs: [
      { book_id: 'luke', chapter: 2, verse_start: 8, verse_end: 10 },
      { book_id: 'luke', chapter: 2, verse_start: 9, verse_end: 12 },
    ], biblical_character: [] } }],
    { chapterExists, verseExists, personExists: () => false },
  );
  const nine = edges.find((e) => e.to_id === 'luke-2-9');
  assert.equal(nine.metadata.range_start, 'luke-2-8');
  assert.equal(nine.metadata.range_end, 'luke-2-12');
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
