// Harness for the D&C+PGP graph spine sync (remediation plan v2 item 1 + D3).
// Pure helpers + fake-cypher flows only — NO network, NO db.
// Run: node --import tsx --test scripts/__tests__/spine-backfill.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BATCH_SIZE,
  PLAN,
  VOLUME_ORDER,
  MOSES_CH_1,
  graphChapterId,
  mapPgChapterId,
  buildReference,
  buildVerseRow,
  classifyVerseTargets,
  buildEdgeRow,
  edgeTupleKey,
  endpointKey,
  planEdgeBatches,
  computeExpectedSkips,
  classifyBatchOutcome,
  unexpectedChapterMissing,
  parseVolumesArg,
  syncRunId,
  assertGraphLabel,
  assertRelType,
  edgeMergeCypher,
  edgeStateProbeCypher,
  endpointProbeCypher,
  VERSE_MERGE,
  CHAPTER_MERGE,
  CONTAINS_MERGE,
  VERSE_STATE_PROBE,
  probeVerseState,
  runMergePhase,
} from '../backfill-neo4j-spine.mjs';
import { chunk } from '../backfill-neo4j-collections.mjs';

// ---------- chapter-id mapper (D3c: legacy mapping, NEVER PG-style ids) ----------

test('graphChapterId maps every in-scope book to the legacy -ch- scheme', () => {
  assert.equal(graphChapterId('dc', 76), 'dc-ch-76');
  assert.equal(graphChapterId('dc', 1), 'dc-ch-1');
  assert.equal(graphChapterId('moses', 1), 'moses-ch-1'); // the one missing chapter, conforms to moses-ch-2..8
  assert.equal(graphChapterId('moses', 8), 'moses-ch-8');
  assert.equal(graphChapterId('abraham', 3), 'abraham-ch-3');
  assert.equal(graphChapterId('a-of-f', 1), 'a-of-f-ch-1');
});

test('graphChapterId long-form exceptions: js-h and js-m', () => {
  assert.equal(graphChapterId('js-h', 1), 'joseph-smith-history-ch-1');
  assert.equal(graphChapterId('js-m', 1), 'joseph-smith-matthew-ch-1');
});

test('graphChapterId never emits a PG-style id (would mint 1,579 duplicates)', () => {
  for (const [book, n] of [['dc', 76], ['moses', 1], ['abraham', 5], ['js-h', 1], ['js-m', 1], ['a-of-f', 1], ['1-ne', 3]]) {
    const id = graphChapterId(book, n);
    assert.match(id, /-ch-\d+$/, `${id} must use the -ch- scheme`);
    assert.notEqual(id, `${book}-${n}`);
  }
});

test('graphChapterId rejects malformed keys', () => {
  assert.throws(() => graphChapterId('dc', 0));
  assert.throws(() => graphChapterId('dc', 1.5));
  assert.throws(() => graphChapterId('', 1));
  assert.throws(() => graphChapterId('dc', 'x'));
});

test('mapPgChapterId: PG {book}-{n} form incl. hyphenated/digit-bearing book ids', () => {
  assert.equal(mapPgChapterId('moses-1'), 'moses-ch-1');
  assert.equal(mapPgChapterId('dc-76'), 'dc-ch-76');
  assert.equal(mapPgChapterId('js-h-1'), 'joseph-smith-history-ch-1');
  assert.equal(mapPgChapterId('js-m-1'), 'joseph-smith-matthew-ch-1');
  assert.equal(mapPgChapterId('a-of-f-1'), 'a-of-f-ch-1');
  assert.equal(mapPgChapterId('1-ne-3'), '1-ne-ch-3');
  assert.throws(() => mapPgChapterId('nonumber'));
});

// ---------- reference-string builder ----------

test('buildReference conforms to the live shape (Doctrine and Covenants 4:2 style)', () => {
  assert.equal(buildReference('Doctrine and Covenants', 4, 2), 'Doctrine and Covenants 4:2');
  assert.equal(buildReference('Moses', 1, 39), 'Moses 1:39');
  assert.equal(buildReference('Joseph Smith—History', 1, 15), 'Joseph Smith—History 1:15');
  assert.equal(buildReference('Articles of Faith', '1', '13'), 'Articles of Faith 1:13'); // PG numerics may arrive as strings
});

test('buildVerseRow emits the exact verified node property shape', () => {
  const { props, chapterGraphId, referenceMismatch } = buildVerseRow({
    id: 'dc-4-2', text: 'Therefore, O ye that embark...', reference: 'Doctrine and Covenants 4:2',
    verse_number: 2, chapter_id: 'dc-4', chapter_number: 4, book_id: 'dc',
    book_name: 'Doctrine and Covenants', volume_id: 'dc',
  });
  assert.deepEqual(props, {
    id: 'dc-4-2',
    text: 'Therefore, O ye that embark...',
    reference: 'Doctrine and Covenants 4:2',
    collection_id: 'canon',
    volume_id: 'dc',
    book_id: 'dc',
    chapter_number: 4,
    verse_number: 2,
  });
  assert.equal(chapterGraphId, 'dc-ch-4');
  assert.equal(referenceMismatch, false);
});

test('buildVerseRow falls back to the builder when PG reference is null, flags mismatches', () => {
  const fallback = buildVerseRow({
    id: 'js-h-1-15', text: 'x', reference: null, verse_number: 15,
    chapter_id: 'js-h-1', chapter_number: 1, book_id: 'js-h',
    book_name: 'Joseph Smith—History', volume_id: 'pgp',
  });
  assert.equal(fallback.props.reference, 'Joseph Smith—History 1:15');
  assert.equal(fallback.chapterGraphId, 'joseph-smith-history-ch-1');
  const mismatch = buildVerseRow({
    id: 'moses-1-1', text: 'x', reference: 'Moses 1:999', verse_number: 1,
    chapter_id: 'moses-1', chapter_number: 1, book_id: 'moses',
    book_name: 'Moses', volume_id: 'pgp',
  });
  assert.equal(mismatch.referenceMismatch, true);
  assert.equal(mismatch.props.reference, 'Moses 1:999'); // PG stays source of truth
});

// ---------- verse target classification (slice stability across re-runs) ----------

const vr = (id) => ({ props: { id }, chapterGraphId: 'x-ch-1' });

test('classifyVerseTargets: fresh run — absent nodes create, 294-class matches, slice excludes them', () => {
  const rows = [vr('dc-1-1'), vr('dc-4-2'), vr('dc-76-22')];
  const observed = new Map([
    ['dc-4-2', { present: true, sync_run: null }], // pre-existing, never touched
    // dc-1-1 / dc-76-22 absent
  ]);
  const t = classifyVerseTargets(rows, observed);
  assert.deepEqual(t.toCreate.map((r) => r.props.id), ['dc-1-1', 'dc-76-22']);
  assert.deepEqual(t.preExisting.map((r) => r.props.id), ['dc-4-2']);
  assert.deepEqual(t.sliceRows.map((r) => r.props.id), ['dc-1-1', 'dc-76-22']);
});

test('classifyVerseTargets: re-run after halt — prior-run nodes stay IN the slice, not re-created', () => {
  const rows = [vr('dc-1-1'), vr('dc-4-2'), vr('dc-76-22')];
  const observed = new Map([
    ['dc-1-1', { present: true, sync_run: 'spine-earlier' }], // created by halted attempt
    ['dc-4-2', { present: true, sync_run: null }],
  ]);
  const t = classifyVerseTargets(rows, observed);
  assert.deepEqual(t.toCreate.map((r) => r.props.id), ['dc-76-22']);
  assert.deepEqual(t.syncedPrior.map((r) => r.props.id), ['dc-1-1']);
  // the slice (edge-phase scope) is STABLE: same set as the fresh run
  assert.deepEqual(t.sliceRows.map((r) => r.props.id).sort(), ['dc-1-1', 'dc-76-22']);
  assert.deepEqual(t.preExisting.map((r) => r.props.id), ['dc-4-2']);
});

// ---------- batch planner boundary behavior (the 19x2000 truncation class) ----------

test('chunk emits the last partial page — no tail truncation (4,289 = 2000+2000+289)', () => {
  const rows = Array.from({ length: 4289 }, (_, i) => i);
  const batches = chunk(rows, BATCH_SIZE);
  assert.deepEqual(batches.map((b) => b.length), [2000, 2000, 289]);
  assert.deepEqual(batches.flat(), rows); // every row exactly once, order kept
});

test('planEdgeBatches never drops the partial tail and covers every row once', () => {
  const rows = Array.from({ length: 4501 }, (_, i) => ({
    fromLabel: 'LM_Verse', toLabel: 'LM_Verse', relType: 'CROSS_REF', from: `v-${i}`, to: `w-${i}`, props: {},
  }));
  const batches = planEdgeBatches(rows, 2000);
  assert.deepEqual(batches.map((b) => b.length), [2000, 2000, 501]);
  assert.equal(batches.flat().length, 4501);
});

test('planEdgeBatches co-batches dup tuples straddling a boundary (sync_run double-count guard)', () => {
  // 1,999 distinct rows then a dup pair: a naive chunk(2000) would split the
  // pair across batches; batch 2 would MERGE-match the just-created rel
  // (carrying this run sync_run) and double-count it as created.
  const distinct = Array.from({ length: 1999 }, (_, i) => ({
    fromLabel: 'LM_Verse', toLabel: 'LM_Verse', relType: 'CROSS_REF', from: `v-${i}`, to: `w-${i}`, props: {},
  }));
  const dup = { fromLabel: 'LM_Verse', toLabel: 'LM_Person', relType: 'MENTIONS', from: 'dc-4-2', to: 'nephi-1', props: {} };
  const rows = [...distinct, dup, { ...dup, props: { source: 'ai-generated' } }];
  const batches = planEdgeBatches(rows, 2000);
  assert.equal(batches.flat().length, 2001);
  for (const batch of batches) {
    const dupRows = batch.filter((r) => edgeTupleKey(r) === edgeTupleKey(dup));
    assert.ok(dupRows.length === 0 || dupRows.length === 2, 'dup tuple must never split across batches');
  }
});

test('planEdgeBatches keeps an oversized tuple group intact in its own batch', () => {
  const mk = (k) => ({ fromLabel: 'LM_Verse', toLabel: 'LM_Verse', relType: 'CROSS_REF', from: k, to: 'x', props: {} });
  const rows = [mk('a'), mk('a'), mk('a'), mk('b')];
  const batches = planEdgeBatches(rows, 2);
  assert.deepEqual(batches.map((b) => b.map((r) => r.from)), [['a', 'a', 'a'], ['b']]);
});

// ---------- stop-condition classifier (write protocol, mandatory) ----------

test('classifyBatchOutcome passes a clean batch', () => {
  assert.deepEqual(
    classifyBatchOutcome({ batchRows: 2000, touchedRows: 2000, cumulativeCreated: 1500, expectedCreated: 3360 }),
    { halt: false, reasons: [] },
  );
});

test('classifyBatchOutcome halts on created+matched != batch size', () => {
  const v = classifyBatchOutcome({ batchRows: 2000, touchedRows: 1999, cumulativeCreated: 100, expectedCreated: 3360 });
  assert.equal(v.halt, true);
  assert.deepEqual(v.reasons, ['created_plus_matched_mismatch']);
});

test('classifyBatchOutcome halts on cumulative created exceeding the dry-run expectation', () => {
  const v = classifyBatchOutcome({ batchRows: 289, touchedRows: 289, cumulativeCreated: 3361, expectedCreated: 3360 });
  assert.equal(v.halt, true);
  assert.deepEqual(v.reasons, ['cumulative_created_overshoot']);
});

test('classifyBatchOutcome: expected skips make an edge batch clean, unexpected ones halt', () => {
  assert.equal(classifyBatchOutcome({ batchRows: 2000, touchedRows: 1990, expectedSkips: 10, cumulativeCreated: 0, expectedCreated: 100 }).halt, false);
  assert.equal(classifyBatchOutcome({ batchRows: 2000, touchedRows: 1989, expectedSkips: 10, cumulativeCreated: 0, expectedCreated: 100 }).halt, true);
  // exactly-at-expectation is NOT an overshoot
  assert.equal(classifyBatchOutcome({ batchRows: 1, touchedRows: 1, cumulativeCreated: 3360, expectedCreated: 3360 }).halt, false);
});

// ---------- edge endpoint resolution (exact label, resolveGraphId, skip counting) ----------

test('buildEdgeRow: verse endpoints by exact PG id, entity endpoints via resolveGraphId', () => {
  const e = buildEdgeRow({
    from_id: 'dc-4-2', to_id: 'person:nephi-1', rel_type: 'MENTIONS',
    metadata: { from_label: 'LM_Verse', to_label: 'LM_Person', reason: 'r', source: 'ai-generated' },
    from_neo4j_id: null, to_neo4j_id: 'nephi-1',
  });
  assert.equal(e.invalid, undefined);
  assert.equal(e.from, 'dc-4-2');
  assert.equal(e.to, 'nephi-1'); // metadata.neo4j_id wins for namespaced entities
  assert.deepEqual(e.props, { reason: 'r', source: 'ai-generated', collection_id: 'phase-b' }); // labels stripped, collection stamped
});

test('buildEdgeRow: a verse endpoint stays exact-id even if the entities join leaks a neo4j_id', () => {
  const e = buildEdgeRow({
    from_id: 'moses-1-39', to_id: 'dc-76-22', rel_type: 'CROSS_REF',
    metadata: { from_label: 'LM_Verse', to_label: 'LM_Verse' },
    from_neo4j_id: 'something-else', to_neo4j_id: null,
  });
  assert.equal(e.from, 'moses-1-39');
  assert.equal(e.to, 'dc-76-22');
});

test('dc exact-label rule: metadata labels drive the MATCH, never a union (id dc is Book AND Volume)', () => {
  const e = buildEdgeRow({
    from_id: 'dc', to_id: 'dc', rel_type: 'IN_VOLUME',
    metadata: { from_label: 'LM_Book', to_label: 'LM_Volume' },
    from_neo4j_id: null, to_neo4j_id: null,
  });
  assert.equal(e.fromLabel, 'LM_Book');
  assert.equal(e.toLabel, 'LM_Volume');
  const cypher = edgeMergeCypher(e.fromLabel, e.toLabel, e.relType);
  assert.match(cypher, /MATCH \(a:LM_Book \{id: row\.from\}\)/);
  assert.match(cypher, /MATCH \(b:LM_Volume \{id: row\.to\}\)/);
  assert.ok(!cypher.includes('|'), 'no label union anywhere in the statement');
});

test('buildEdgeRow flags rows the writer must not attempt', () => {
  assert.equal(buildEdgeRow({ from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF', metadata: {} }).reason, 'missing_or_unknown_label');
  assert.equal(buildEdgeRow({
    from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF',
    metadata: { from_label: 'Verse) DETACH DELETE (n', to_label: 'LM_Verse' },
  }).reason, 'missing_or_unknown_label');
  assert.equal(buildEdgeRow({
    from_id: 'a', to_id: 'b', rel_type: 'bad-type',
    metadata: { from_label: 'LM_Verse', to_label: 'LM_Verse' },
  }).reason, 'bad_rel_type');
  assert.equal(buildEdgeRow({
    from_id: 'a', to_id: 'b', rel_type: 'CROSS_REF',
    metadata: { from_label: 'LM_Verse', to_label: 'LM_Verse', nested: { deep: true } },
  }).reason, 'nested_props');
});

test('computeExpectedSkips: row-level counting, dup rows of a skipped tuple both count', () => {
  const mk = (from, to, toLabel = 'LM_Person') => ({ fromLabel: 'LM_Verse', toLabel, relType: 'MENTIONS', from, to, props: {} });
  const rows = [
    mk('dc-1-1', 'present-entity'),
    mk('dc-1-1', 'absent-entity'),
    mk('dc-1-1', 'absent-entity'), // dup pair on a skipped tuple
    mk('dc-1-1', 'moses-1', 'LM_Chapter'), // PG-style chapter endpoint — MATCH-only skip
  ];
  const willExist = new Set([
    endpointKey('LM_Verse', 'dc-1-1'), // slice verse: will be created
    endpointKey('LM_Person', 'present-entity'),
  ]);
  const { skippedRows, skippedTuples, byLabel } = computeExpectedSkips(rows, willExist);
  assert.equal(skippedRows, 3);
  assert.equal(skippedTuples, 2);
  assert.deepEqual(byLabel, { LM_Person: 2, LM_Chapter: 1 });
});

// ---------- cypher builders: injection guards + ON CREATE SET-only stamping ----------

test('label/rel-type validation is allowlist-based (labels are interpolated into Cypher)', () => {
  assert.equal(assertGraphLabel('LM_Verse'), 'LM_Verse');
  assert.throws(() => assertGraphLabel('LM_Verse) DETACH DELETE (n'));
  assert.throws(() => assertGraphLabel('Verse'));
  assert.equal(assertRelType('CROSS_REF'), 'CROSS_REF');
  assert.throws(() => assertRelType('x'));
  assert.throws(() => assertRelType('CROSS REF'));
  assert.throws(() => edgeMergeCypher('LM_Verse', 'NotALabel', 'CROSS_REF'));
  assert.throws(() => edgeStateProbeCypher('LM_Verse', 'LM_Verse', 'bad type'));
  assert.throws(() => endpointProbeCypher('NotALabel'));
});

test('every write statement stamps sync_run via ON CREATE SET only (matched elements never gain it)', () => {
  for (const stmt of [VERSE_MERGE, CHAPTER_MERGE, CONTAINS_MERGE, edgeMergeCypher('LM_Verse', 'LM_Person', 'MENTIONS')]) {
    assert.match(stmt, /ON CREATE SET [^\n]*sync_run = \$syncRun/);
    const bareSets = stmt.split('\n').filter((l) => /\bSET\b/.test(l) && !/ON CREATE SET/.test(l));
    assert.deepEqual(bareSets, [], 'no bare SET outside ON CREATE');
  }
});

test('CONTAINS is stamped canon (documented divergence from the phase-b legacy rels)', () => {
  assert.match(CONTAINS_MERGE, /ON CREATE SET r\.collection_id = 'canon'/);
});

// ---------- fake-cypher flows ----------

test('probeVerseState pages the full id set incl. the last partial page (truncation class)', async () => {
  const ids = Array.from({ length: 4289 }, (_, i) => `dc-x-${i}`);
  const graph = new Map([
    ['dc-x-0', { sync_run: null }], // 294-class
    ['dc-x-1', { sync_run: 'spine-old' }], // prior-attempt class
  ]);
  const calls = [];
  const fakeCypher = async (statement, params) => {
    assert.equal(statement, VERSE_STATE_PROBE);
    calls.push(params.ids.length);
    return params.ids.map((id) => ({ id, present: graph.has(id), sync_run: graph.get(id)?.sync_run ?? null }));
  };
  const observed = await probeVerseState(fakeCypher, ids);
  assert.deepEqual(calls, [2000, 2000, 289]); // last partial page NOT dropped
  assert.equal(observed.size, 4289);
  assert.deepEqual(observed.get('dc-x-0'), { present: true, sync_run: null });
  assert.deepEqual(observed.get('dc-x-1'), { present: true, sync_run: 'spine-old' });
  assert.deepEqual(observed.get('dc-x-2'), { present: false, sync_run: null });
});

test('runMergePhase accumulates created/matched/skipped across batches', async () => {
  const batches = [[1, 2, 3], [4, 5]];
  const results = [
    { touchedRows: 3, distinctTouched: 3, createdDistinct: 2 },
    { touchedRows: 2, distinctTouched: 2, createdDistinct: 1 },
  ];
  let call = 0;
  const run = await runMergePhase({
    phase: 't', batches, statement: 'S', paramsForBatch: (rows) => ({ rows }),
    cypher: async () => [results[call++]], expectedCreated: 3,
  });
  assert.deepEqual(run, { halted: false, created: 3, matched: 2, skipped: 0 });
});

test('runMergePhase HALTS IMMEDIATELY on created+matched mismatch — later batches never run', async () => {
  let calls = 0;
  const run = await runMergePhase({
    phase: 't', batches: [[1, 2], [3, 4], [5, 6]], statement: 'S', paramsForBatch: (rows) => ({ rows }),
    cypher: async () => {
      calls++;
      return [{ touchedRows: 1, distinctTouched: 1, createdDistinct: 1 }]; // 1 != 2
    },
    expectedCreated: 100,
  });
  assert.equal(run.halted, true);
  assert.equal(run.reason, 'created_plus_matched_mismatch');
  assert.equal(run.batch, 1);
  assert.equal(calls, 1, 'no continue-on-failure');
});

test('runMergePhase halts on cumulative created overshoot mid-phase', async () => {
  let calls = 0;
  const run = await runMergePhase({
    phase: 't', batches: [[1, 2], [3, 4], [5, 6]], statement: 'S', paramsForBatch: (rows) => ({ rows }),
    cypher: async () => {
      calls++;
      return [{ touchedRows: 2, distinctTouched: 2, createdDistinct: 2 }];
    },
    expectedCreated: 3, // batch 2 reaches 4 created > 3
  });
  assert.equal(run.halted, true);
  assert.equal(run.reason, 'cumulative_created_overshoot');
  assert.equal(run.batch, 2);
  assert.equal(calls, 2);
});

test('runMergePhase halts on a batch error without touching remaining batches', async () => {
  let calls = 0;
  const run = await runMergePhase({
    phase: 't', batches: [[1], [2]], statement: 'S', paramsForBatch: (rows) => ({ rows }),
    cypher: async () => {
      calls++;
      throw new Error('neo.TransientError.General.OutOfMemoryError');
    },
    expectedCreated: 2,
  });
  assert.equal(run.halted, true);
  assert.equal(run.reason, 'batch_error');
  assert.equal(calls, 1);
});

test('runMergePhase honors per-batch expected skips (edge slice) and still halts past them', async () => {
  const rows = [
    { fromLabel: 'LM_Verse', toLabel: 'LM_Person', relType: 'MENTIONS', from: 'v1', to: 'gone', props: {} },
    { fromLabel: 'LM_Verse', toLabel: 'LM_Person', relType: 'MENTIONS', from: 'v1', to: 'here', props: {} },
  ];
  const willExist = new Set([endpointKey('LM_Verse', 'v1'), endpointKey('LM_Person', 'here')]);
  const clean = await runMergePhase({
    phase: 'edges', batches: [rows], statement: 'S', paramsForBatch: (r) => ({ rows: r }),
    cypher: async () => [{ touchedRows: 1, distinctTouched: 1, createdDistinct: 1 }],
    expectedCreated: 1,
    expectedSkipsForBatch: (r) => computeExpectedSkips(r, willExist).skippedRows,
  });
  assert.deepEqual(clean, { halted: false, created: 1, matched: 0, skipped: 1 });
  const dirty = await runMergePhase({
    phase: 'edges', batches: [rows], statement: 'S', paramsForBatch: (r) => ({ rows: r }),
    cypher: async () => [{ touchedRows: 0, distinctTouched: 0, createdDistinct: 0 }], // an UNexpected extra skip
    expectedCreated: 1,
    expectedSkipsForBatch: (r) => computeExpectedSkips(r, willExist).skippedRows,
  });
  assert.equal(dirty.halted, true);
});

// ---------- config surface ----------

test('plan pins match the remediation plan exactly (3,654/138 dc · 635/16 pgp · 294 · 3,360+635)', () => {
  assert.deepEqual(PLAN.dc, { pgVerses: 3654, pgChapters: 138, preExistingGraphVerses: 294, expectedVerseCreate: 3360 });
  assert.deepEqual(PLAN.pgp, { pgVerses: 635, pgChapters: 16, preExistingGraphVerses: 0, expectedVerseCreate: 635 });
  assert.equal(PLAN.dc.expectedVerseCreate + PLAN.pgp.expectedVerseCreate, 3995);
});

test('moses-ch-1 node shape and volume ordering (canary first)', () => {
  assert.deepEqual(MOSES_CH_1, { id: 'moses-ch-1', name: 'Moses 1', chapter_number: 1, book_id: 'moses' });
  assert.deepEqual(VOLUME_ORDER, ['pgp', 'dc']);
});

test('parseVolumesArg scopes runs, pgp always ahead of dc', () => {
  assert.deepEqual(parseVolumesArg([]), ['pgp', 'dc']);
  assert.deepEqual(parseVolumesArg(['--volume=all']), ['pgp', 'dc']);
  assert.deepEqual(parseVolumesArg(['--volume=pgp']), ['pgp']);
  assert.deepEqual(parseVolumesArg(['--volume=dc']), ['dc']);
  assert.throws(() => parseVolumesArg(['--volume=ot']));
});

test('syncRunId: SYNC_RUN env wins, else timestamped', () => {
  assert.equal(syncRunId({ SYNC_RUN: 'spine-manual-1' }), 'spine-manual-1');
  const generated = syncRunId({}, new Date('2026-07-21T12:00:00.000Z'));
  assert.equal(generated, 'spine-2026-07-21T12-00-00-000Z');
});

test('unexpectedChapterMissing tolerates only moses-ch-1', () => {
  assert.deepEqual(unexpectedChapterMissing(['moses-ch-1']), []);
  assert.deepEqual(unexpectedChapterMissing([]), []);
  assert.deepEqual(unexpectedChapterMissing(['moses-ch-1', 'dc-ch-77']), ['dc-ch-77']);
});

// ---------- reviewer-fix pins (2026-07-21) ----------

test('planEdgeBatches orders dup groups curated-first (deterministic MERGE first-row-wins)', () => {
  const mk = (source) => ({
    fromLabel: 'LM_Verse', toLabel: 'LM_Verse', relType: 'CROSS_REF',
    from: '1-cor-1-27', to: 'ether-12-27', props: source ? { source } : {},
  });
  const [batch] = planEdgeBatches([mk('ai-generated'), mk('bible-bom-curated')], 2000);
  assert.equal(batch[0].props.source, 'bible-bom-curated', 'curated row leads its tuple group');
  assert.equal(batch[1].props.source, 'ai-generated');
});

test('buildEdgeRow: chapter-endpoint non-CONTAINS is a checked invariant, not a silent skip', () => {
  const row = buildEdgeRow({
    from_id: 'dc-4', to_id: 'nephi-1', rel_type: 'MENTIONS',
    metadata: { from_label: 'LM_Chapter', to_label: 'LM_Person' },
  });
  assert.equal(row.invalid, true);
  assert.equal(row.reason, 'chapter_endpoint_non_contains');
});

test('runMergePhase halts on end-of-phase UNDERSHOOT (created < expected)', async () => {
  const run = await runMergePhase({
    phase: 't', batches: [[1, 2]], statement: 'S', paramsForBatch: (rows) => ({ rows }),
    cypher: async () => [{ touchedRows: 2, distinctTouched: 2, createdDistinct: 1 }],
    expectedCreated: 2,
  });
  assert.equal(run.halted, true);
  assert.equal(run.reason, 'created_expected_mismatch');
  assert.equal(run.created, 1);
});
