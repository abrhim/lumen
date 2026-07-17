// Harness (unshaken-ingest A1): H1–H9 per docs/features/unshaken-ingest/plan.md.
// Run: node --test scripts/__tests__/ingest-podcast.test.mjs
// Written harness-FIRST: imports target modules that do not exist yet — the
// initial run MUST fail (harness-template rule). Contracts under test are the
// plan's public stage functions, DI-style like the other scripts harnesses.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseTitle, anchorsForBlock } from '../ingest-podcast/parse-title.mjs';
import { filterEpisodes } from '../ingest-podcast/discover.mjs';
import { bestAudioArgs, assertDownloadedId } from '../ingest-podcast/fetch.mjs';
import {
  buildDeepgramRequest,
  validateUtterances,
  utterancesToRows,
} from '../ingest-podcast/transcribe.mjs';
import { buildLoadPlan } from '../ingest-podcast/load.mjs';
import { UNSHAKEN } from '../ingest-podcast/shows/unshaken.mjs';
import { scrubSecrets, childEnv, assertVideoId } from '../ingest-podcast/util.mjs';
import { isValidEpisodesArtifact } from '../ingest-podcast/discover.mjs';
import { isValidAudioArtifact } from '../ingest-podcast/fetch.mjs';
import { MEDIA_DDL, ROLE_GRANT_SQL } from '../migrate-media-collections.mjs';

// ── fixtures: the NINE live titles (probe 2026-07-17) + hostile synthetics ──

const LIVE = [
  ['Come Follow Me - 2 Kings 14-25 - The Scattering of Israel',
    [{ book: '2 Kings', start: 14, end: 25 }], 'The Scattering of Israel'],
  ['Come Follow Me - 2 Kings 1-13 - Passing the Mantle',
    [{ book: '2 Kings', start: 1, end: 13 }], 'Passing the Mantle'],
  ['Come Follow Me - 1 Kings 12-22 - Elijah’s Ministry and Miracles',
    [{ book: '1 Kings', start: 12, end: 22 }], 'Elijah’s Ministry and Miracles'],
  // the separator TRAP: " - " appears INSIDE the cross-book block
  ['Come Follow Me - 1 Samuel 17 - 2 Samuel 10 - David: From Shepherd to King',
    [{ book: '1 Samuel', start: 17, end: null }, { book: '2 Samuel', start: 1, end: 10 }],
    'David: From Shepherd to King'],
  ['Come Follow Me - 1 Samuel 8-16 - The Rise and Fall of Saul',
    [{ book: '1 Samuel', start: 8, end: 16 }], 'The Rise and Fall of Saul'],
  // multi-book "&": Ruth is whole-book, 1 Samuel ranged
  ['Come Follow Me - Ruth & 1 Samuel 1-7 - Women of Faith',
    [{ book: 'Ruth', start: 1, end: null }, { book: '1 Samuel', start: 1, end: 7 }],
    'Women of Faith'],
  // whole-book form with colon subtitle, no " - " before subtitle
  ['Come Follow Me - The Book of Joshua: Choose You This Day',
    [{ book: 'Joshua', start: 1, end: null }], 'Choose You This Day'],
  ['Come Follow Me - The Book of Numbers: Look and Live',
    [{ book: 'Numbers', start: 1, end: null }], 'Look and Live'],
  ['Come Follow Me - The Book of Leviticus: Holiness to the Lord',
    [{ book: 'Leviticus', start: 1, end: null }], 'Holiness to the Lord'],
];

const HOSTILE = [
  // subtitle containing " - " must not be eaten by block parsing
  ['Come Follow Me - 2 Kings 1-13 - Mantles, Miracles - and Mockers',
    [{ book: '2 Kings', start: 1, end: 13 }], 'Mantles, Miracles - and Mockers'],
  // unicode en-dash in the range (strongs lesson: dash classes are real)
  ['Come Follow Me - 2 Kings 14–25 - The Scattering',
    [{ book: '2 Kings', start: 14, end: 25 }], 'The Scattering'],
  // ampersand in SUBTITLE must not trigger multi-book parsing
  ['Come Follow Me - 1 Kings 12-22 - Kings & Prophets',
    [{ book: '1 Kings', start: 12, end: 22 }], 'Kings & Prophets'],
];

const LOOKUP = {
  bookIdByName: {
    'Ruth': 'ruth', 'Joshua': 'josh', 'Numbers': 'num', 'Leviticus': 'lev',
    '1 Samuel': '1-sam', '2 Samuel': '2-sam', '1 Kings': '1-kgs', '2 Kings': '2-kgs',
  },
  chapterCount: { ruth: 4, josh: 24, num: 36, lev: 27, '1-sam': 31, '2-sam': 24, '1-kgs': 22, '2-kgs': 25 },
};

const dgUtterance = (o = {}) => ({ start: 12.42, end: 19.87, transcript: 'And Elisha said unto him', confidence: 0.98, ...o });
const dgResponse = (utts) => ({ results: { utterances: utts } });

// ── H1: title grammar totality over LIVE + HOSTILE ──────────────────────────

for (const [title, spans, subtitle] of [...LIVE, ...HOSTILE]) {
  test(`H1: parseTitle(${JSON.stringify(title.slice(17, 55))}…)`, () => {
    const p = parseTitle(title);
    assert.ok(p, 'must parse');
    assert.deepEqual(p.spans, spans);
    assert.equal(p.subtitle, subtitle);
  });
}

test('H1: non-CFM titles are rejected, not misparsed (clips filter)', () => {
  assert.equal(parseTitle('The Myth of Spiritual Switzerland: Elijah and Priests of Baal'), null);
  assert.equal(parseTitle('Come Follow Along - 2 Kings 1-13 - Impostor Prefix'), null);
});

// ── H7: anchor expansion (whole-book, cross-book, ranged) ───────────────────

test('H7: whole-book block anchors exactly chapterCount chapters (Joshua=24)', () => {
  const ids = anchorsForBlock([{ book: 'Joshua', start: 1, end: null }], LOOKUP);
  assert.equal(ids.length, 24);
  assert.equal(ids[0], 'josh-1');
  assert.equal(ids[23], 'josh-24');
});

test('H7: cross-book open end resolves to end of first book (1 Sam 17 → 2 Sam 10)', () => {
  const ids = anchorsForBlock(
    [{ book: '1 Samuel', start: 17, end: null }, { book: '2 Samuel', start: 1, end: 10 }],
    LOOKUP,
  );
  assert.equal(ids.length, (31 - 17 + 1) + 10);
  assert.equal(ids[0], '1-sam-17');
  assert.equal(ids.at(-1), '2-sam-10');
});

test('H7: unknown book name fails loudly, never silently drops (fail-closed)', () => {
  assert.throws(() => anchorsForBlock([{ book: 'Hezekiah', start: 1, end: 2 }], LOOKUP));
});

// ── discover: filter + ordering contract ────────────────────────────────────

test('discover: CFM filter takes deep dives only, newest-first, capped at N', () => {
  const raw = [
    { id: 'clip1', title: 'Donkey Heads and Dove Dung: Surviving a Spiritual Famine' },
    { id: '4pSrikfJ5Yw', title: 'Come Follow Me - 2 Kings 14-25 - The Scattering of Israel' },
    { id: 'clip2', title: 'He’s Not in the Noise: Hearing the Still Small Voice' },
    { id: '6lXWLIOUKC8', title: 'Come Follow Me - 2 Kings 1-13 - Passing the Mantle' },
  ];
  const eps = filterEpisodes(raw, { ...UNSHAKEN, episodeCount: 1 });
  assert.equal(eps.length, 1);
  assert.equal(eps[0].id, '4pSrikfJ5Yw');
});

// ── H3: alignment invariant — audio from the SAME videoId we embed ──────────

test('H3: bestAudioArgs builds from the exact videoId and requests audio-only', () => {
  const args = bestAudioArgs('4pSrikfJ5Yw', '/tmp/out.m4a');
  const joined = args.join(' ');
  assert.ok(joined.includes('https://www.youtube.com/watch?v=4pSrikfJ5Yw'));
  assert.ok(/bestaudio/.test(joined));
  assert.ok(!/bestvideo|\bmp4\b/.test(joined), 'no video download');
  // REL-2 residual: yt-dlp's default .part + atomic rename is load-bearing
  // for resume safety — never opt out of it.
  assert.ok(!joined.includes('--no-part'));
});

test('SEC-5: videoId is charset-validated before it can reach argv', () => {
  assert.doesNotThrow(() => assertVideoId('4pSrikfJ5Yw'));
  assert.throws(() => assertVideoId('bad;rm -rf /'));
  assert.throws(() => assertVideoId('short'));
  assert.throws(() => bestAudioArgs('$(evil)', '/tmp/out.m4a'));
});

test('SEC-3: child env is subtractive — secrets stripped, tool needs kept', () => {
  const env = childEnv({
    PATH: '/usr/bin',
    HOME: '/Users/abram',
    TMPDIR: '/tmp',
    DEEPGRAM_API_KEY: 'sekret',
    DATABASE_URL: 'postgresql://u:p@h/db',
  });
  assert.equal(env.DEEPGRAM_API_KEY, undefined);
  assert.equal(env.DATABASE_URL, undefined);
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/Users/abram');
  assert.equal(env.TMPDIR, '/tmp');
});

test('SEC-1/SEC-2: scrubSecrets redacts bearer tokens, DSNs, and the live key', () => {
  const msg = 'fail Token abc123XYZ at postgresql://user:hunter2@db.host/x DEEPGRAM_API_KEY=raw123';
  const out = scrubSecrets(msg, { extraSecrets: ['raw123'] });
  assert.ok(!out.includes('abc123XYZ'), 'bearer token');
  assert.ok(!out.includes('hunter2'), 'DSN password');
  assert.ok(!out.includes('raw123'), 'raw key value');
});

test('H3: assertDownloadedId rejects a mismatched stream id', () => {
  assert.throws(() => assertDownloadedId({ id: 'DIFFERENT' }, '4pSrikfJ5Yw'));
  assert.doesNotThrow(() => assertDownloadedId({ id: '4pSrikfJ5Yw' }, '4pSrikfJ5Yw'));
});

// ── H5 + H9: Deepgram request/response contracts ────────────────────────────

test('H9: API key travels as header only — never argv/URL (ps leak)', () => {
  const req = buildDeepgramRequest({ apiKey: 'sekret', keyterms: ['Elisha'], model: 'nova-3' });
  assert.equal(req.headers.Authorization, 'Token sekret');
  assert.ok(!req.url.includes('sekret'));
  assert.ok(!JSON.stringify(req.query ?? {}).includes('sekret'));
});

test('H5: utterances=true and smart_format=true are non-negotiable request params', () => {
  const req = buildDeepgramRequest({ apiKey: 'k', keyterms: [], model: 'nova-3' });
  assert.equal(req.query.utterances, 'true');
  assert.equal(req.query.smart_format, 'true');
});

test('H5: empty utterances rejected', () => {
  assert.throws(() => validateUtterances(dgResponse([])));
});

test('REL-1: transcript coverage checked against episode duration when provided', () => {
  const short = dgResponse([dgUtterance({ start: 10, end: 100 })]);
  assert.throws(
    () => validateUtterances(short, { durationS: 12992, tailToleranceS: 300 }),
    /coverage|duration/i,
  );
  assert.doesNotThrow(() => validateUtterances(short, { durationS: 130, tailToleranceS: 300 }));
});

test('H10 (CON-8): cached artifacts skip only when VALID', () => {
  assert.equal(isValidEpisodesArtifact({ episodes: [{ id: 'a'.repeat(11), title: 't' }] }, { episodeCount: 1 }), true);
  assert.equal(isValidEpisodesArtifact({ episodes: [] }, { episodeCount: 10 }), false);
  assert.equal(isValidEpisodesArtifact(null, { episodeCount: 10 }), false);
  const stat = () => ({ exists: true, size: 1024 });
  assert.equal(isValidAudioArtifact('/x/ep.m4a', stat), true);
  // the .part path EXISTS in this fake — rejection must come from the NAME,
  // not from absence (review fix: exists:false here passed for the wrong reason)
  assert.equal(isValidAudioArtifact('/x/ep.m4a.part', stat), false);
  assert.equal(isValidAudioArtifact('/x/missing.m4a', () => ({ exists: false, size: 0 })), false);
  assert.equal(isValidAudioArtifact('/x/empty.m4a', () => ({ exists: true, size: 0 })), false);
});

test('H5: non-monotonic timestamps rejected', () => {
  const bad = [dgUtterance({ start: 10, end: 20 }), dgUtterance({ start: 5, end: 8 })];
  assert.throws(() => validateUtterances(dgResponse(bad)));
});

test('H5: negative or end<start timestamps rejected', () => {
  assert.throws(() => validateUtterances(dgResponse([dgUtterance({ start: -1 })])));
  assert.throws(() => validateUtterances(dgResponse([dgUtterance({ start: 9, end: 3 })])));
});

test('utterancesToRows: seq is 0-based dense, seconds preserved to ms fidelity', () => {
  const rows = utterancesToRows(dgResponse([
    dgUtterance({ start: 1.5, end: 3.25, transcript: 'a' }),
    dgUtterance({ start: 3.25, end: 9.001, transcript: 'b' }),
  ]), 'unshaken-4pSrikfJ5Yw');
  assert.deepEqual(rows.map((r) => r.seq), [0, 1]);
  assert.equal(rows[1].t_start_s, 3.25);
  assert.equal(rows[1].t_end_s, 9.001);
  assert.equal(rows[0].episode_id, 'unshaken-4pSrikfJ5Yw');
});

// ── H2 + H4 + H8: load plan — parameterization, idempotency, projections ────

const episodeFixture = {
  videoId: '4pSrikfJ5Yw',
  title: "Come Follow Me - 2 Kings 14-25 - Bobby'); DROP TABLE lumen.entities;--",
  subtitle: "Bobby'); DROP TABLE lumen.entities;--",
  spans: [{ book: '2 Kings', start: 14, end: 25 }],
  uploadDate: '20260712',
  durationS: 12992,
};

test('H2: hostile title text appears ONLY in parameter values, never SQL text', () => {
  const plan = buildLoadPlan(episodeFixture, [
    { seq: 0, t_start_s: 0, t_end_s: 2, text: 'x', speaker: null },
  ], ['2-kgs-14'], UNSHAKEN);
  for (const stmt of plan.statements) {
    assert.ok(!stmt.text.includes('DROP TABLE'), `interpolated title in: ${stmt.text.slice(0, 60)}`);
  }
  const values = JSON.stringify(plan.statements.map((s) => s.values));
  assert.ok(values.includes('DROP TABLE'), 'title must still be stored verbatim');
});

test('H4: load plan is delete-then-insert per episode (re-run identical)', () => {
  const rows = [{ seq: 0, t_start_s: 0, t_end_s: 2, text: 'x', speaker: null }];
  const p1 = buildLoadPlan(episodeFixture, rows, ['2-kgs-14'], UNSHAKEN);
  const p2 = buildLoadPlan(episodeFixture, rows, ['2-kgs-14'], UNSHAKEN);
  assert.deepEqual(p1.statements, p2.statements, 'deterministic plan');
  const kinds = p1.statements.map((s) => s.text.trim().slice(0, 6).toUpperCase());
  const firstInsert = kinds.indexOf('INSERT');
  const deletesAfterInsert = kinds.slice(firstInsert).filter((k) => k === 'DELETE');
  assert.equal(deletesAfterInsert.length, 0, 'all DELETEs precede INSERTs');
  assert.ok(kinds.includes('DELETE'), 'idempotency requires the delete pass');
});

test('H4: transcript deletes are unnecessary by construction (FK cascade) OR explicit', () => {
  const plan = buildLoadPlan(episodeFixture, [], [], UNSHAKEN);
  const touchesTranscripts = plan.statements.some((s) => /lumen\.transcripts/i.test(s.text));
  const deletesEntity = plan.statements.some((s) => /DELETE FROM lumen\.entities/i.test(s.text));
  assert.ok(deletesEntity || touchesTranscripts, 'episode replacement path must exist');
});

test('H4/COR-1: edges get an explicit scoped delete — edges have no PK/cascade', () => {
  const plan = buildLoadPlan(episodeFixture, [], ['2-kgs-14'], UNSHAKEN);
  const edgeDelete = plan.statements.find(
    (s) => /DELETE FROM lumen\.edges/i.test(s.text) && /collection_id/i.test(s.text),
  );
  assert.ok(edgeDelete, 'DELETE FROM lumen.edges scoped by episode + collection required');
});

test('COR-2: every anchored chapter becomes exactly one edge row (Joshua=24)', () => {
  const joshua = Array.from({ length: 24 }, (_, i) => `josh-${i + 1}`);
  const plan = buildLoadPlan(
    { ...episodeFixture, spans: [{ book: 'Joshua', start: 1, end: null }] },
    [], joshua, UNSHAKEN,
  );
  assert.equal(plan.summary.edges, 24);
  assert.equal(plan.summary.entities, 1);
});

test('REL-8: collection row upserts public=false until Phase B flips it deliberately', () => {
  const plan = buildLoadPlan(episodeFixture, [], [], UNSHAKEN);
  const coll = plan.statements.find((s) => /lumen\.collections/i.test(s.text));
  assert.ok(coll, 'collection upsert required');
  assert.ok(/public/i.test(coll.text));
  assert.ok(coll.values.includes(false), 'public=false in values');
});

test('H8: search projection weights — title=A, subtitle=B, block=C', () => {
  const plan = buildLoadPlan(episodeFixture, [], ['2-kgs-14'], UNSHAKEN);
  const search = plan.statements.find((s) => /lumen\.search_index/i.test(s.text));
  assert.ok(search, 'search projection row required');
  assert.ok(/setweight\(.*'A'\)/.test(search.text));
  assert.ok(/setweight\(.*'B'\)/.test(search.text));
  const a = search.text.indexOf("'A'");
  const b = search.text.indexOf("'B'");
  assert.ok(a !== -1 && b !== -1 && a < b, 'A weight bound before B');
});

test('edges: DISCUSSES carries title provenance and confidence 1 with EMPTY mentions', () => {
  const plan = buildLoadPlan(episodeFixture, [], ['2-kgs-14', '2-kgs-15'], UNSHAKEN);
  const edge = plan.statements.find((s) => /lumen\.edges/i.test(s.text));
  assert.ok(edge);
  const meta = JSON.stringify(edge.values);
  assert.ok(meta.includes('"source":"title"'));
  assert.ok(meta.includes('"mentions":[]'), 'mentions array reserved for A2, present and empty');
});

// ── H6: migration safety ────────────────────────────────────────────────────

test('H6: DDL is idempotent (IF NOT EXISTS on both tables + index)', () => {
  const stmts = MEDIA_DDL.match(/CREATE TABLE IF NOT EXISTS/g) ?? [];
  assert.equal(stmts.length, 2, 'transcripts + search_index');
  assert.ok(/CREATE INDEX IF NOT EXISTS/.test(MEDIA_DDL));
  assert.ok(/ON DELETE CASCADE/.test(MEDIA_DDL), 'collection-rollback FK');
});

test('H6: role grant APPENDS admin.collections, never replaces the array (⊇ rule)', () => {
  assert.ok(/array_append|\|\|/.test(ROLE_GRANT_SQL), 'append semantics');
  assert.ok(/NOT .*= ANY|NOT EXISTS|@>/.test(ROLE_GRANT_SQL), 'idempotent guard');
  assert.ok(!/SET entitlements = ARRAY\[/.test(ROLE_GRANT_SQL), 'no wholesale replace');
});

test('SEC-4: role grant is scoped to the admin role, not all roles', () => {
  assert.ok(/WHERE[^;]*slug\s*=\s*'admin'/.test(ROLE_GRANT_SQL), "WHERE slug='admin' scope");
});

test('H6/COR-1: partial unique index guards unshaken edges without touching phase-b dups', () => {
  assert.ok(
    /CREATE UNIQUE INDEX IF NOT EXISTS[^;]*lumen\.edges[^;]*WHERE collection_id = 'unshaken'/.test(
      MEDIA_DDL,
    ),
    'partial unique index scoped to the unshaken collection',
  );
});
