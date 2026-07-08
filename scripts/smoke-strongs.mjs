// Live post-ingest invariants for the Strong's word tags + lexicon.
//   node scripts/smoke-strongs.mjs
// Exit 0/1. Run AFTER ingest-strongs.mjs, BEFORE web deploy.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let sql;
try {
  const envPath = join(ROOT, '.env');
  if (!existsSync(envPath)) throw new Error('root .env with DATABASE_URL required');
  const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
  if (!url) throw new Error('DATABASE_URL not found in root .env');
  const require = createRequire(import.meta.url);
  const postgres = require('postgres');
  sql = postgres(url, { prepare: false, max: 1 });
} catch (err) {
  console.error('✗ fatal:', scrub(err.message));
  process.exit(1);
}

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  await sql.unsafe(`SET statement_timeout = '120s'`);

  const [n] = await sql`SELECT count(*)::int AS n FROM lumen.word_tags`;
  check('word_tags magnitude sane (~790k expected)', n.n > 600000 && n.n < 900000, `${n.n}`);
  const [lex] = await sql`SELECT count(*)::int AS n FROM lumen.strongs_lexicon`;
  check('lexicon loaded (~14k entries)', lex.n > 10000, `${lex.n}`);

  const [marker] = await sql`SELECT value FROM lumen.migration_state WHERE key = 'strongs-ingest'`;
  check('run marker present', !!marker, marker ? `inserted=${marker.value.inserted} coverage=${marker.value.coverage}` : 'missing');
  if (marker) {
    check('live count matches last ingest (re-run stable)', n.n === marker.value.inserted, `${n.n} vs ${marker.value.inserted}`);
    // coverage FLOOR (PO-7): tagged Bible words / Bible words
    check('coverage ≥ 85% of Bible words', marker.value.coverage >= 0.85, `${marker.value.coverage}`);
  }

  const [orph] = await sql`
    SELECT count(*)::int AS n FROM lumen.word_tags t
    WHERE NOT EXISTS (SELECT 1 FROM lumen.words w WHERE w.id = t.word_id)`;
  check('zero orphan word_ids', orph.n === 0, `${orph.n}`);

  // canaries (amendment: pinned from the probe)
  const gen = await sql`
    SELECT t.strongs FROM lumen.word_tags t
    JOIN lumen.words w ON w.id = t.word_id
    WHERE w.verse_id = 'gen-1-1' AND w.normalized = 'beginning'`;
  check("gen-1-1 'beginning' → H7225", gen.length === 1 && gen[0].strongs.includes('H7225'), JSON.stringify(gen[0]?.strongs));
  const loved = await sql`
    SELECT t.strongs, t.morph FROM lumen.word_tags t
    JOIN lumen.words w ON w.id = t.word_id
    WHERE w.verse_id = 'john-3-16' AND w.normalized = 'loved'`;
  check("john-3-16 'loved' → G25 + V-AAI-3S", loved.length === 1 && loved[0].strongs.includes('G25') && /V-AAI-3S/.test(loved[0].morph ?? ''), `${JSON.stringify(loved[0]?.strongs)} ${loved[0]?.morph}`);

  // phrase spans tag every member (Q3): 'in' + 'the' + 'beginning' share H7225
  const [phrase] = await sql`
    SELECT count(*)::int AS n FROM lumen.word_tags t
    JOIN lumen.words w ON w.id = t.word_id
    WHERE w.verse_id = 'gen-1-1' AND w.position <= 3 AND t.strongs @> ARRAY['H7225']::text[]`;
  check('phrase span tags all members (gen-1-1 words 1-3 → H7225)', phrase.n === 3, `${phrase.n}`);

  // lexicon joins resolve for the most-used numbers (FM-10)
  const unresolved = await sql`
    SELECT s.no, count(*)::int AS uses FROM lumen.word_tags t
    CROSS JOIN LATERAL unnest(t.strongs) AS s(no)
    LEFT JOIN lumen.strongs_lexicon l ON l.strongs_no = s.no
    WHERE l.strongs_no IS NULL
    GROUP BY s.no ORDER BY uses DESC LIMIT 5`;
  const [unresolvedTotal] = await sql`
    SELECT count(DISTINCT s.no)::int AS n FROM lumen.word_tags t
    CROSS JOIN LATERAL unnest(t.strongs) AS s(no)
    LEFT JOIN lumen.strongs_lexicon l ON l.strongs_no = s.no
    WHERE l.strongs_no IS NULL`;
  check('unresolved lexicon numbers are rare (<50 distinct)', unresolvedTotal.n < 50,
    `${unresolvedTotal.n} distinct; top: ${unresolved.map((u) => `${u.no}×${u.uses}`).join(' ')}`);

  // EXPLAIN sanity: both hot queries use indexes
  const q1 = await sql.unsafe(`EXPLAIN SELECT t.word_id FROM lumen.word_tags t JOIN lumen.words w ON w.id = t.word_id WHERE w.verse_id = 'john-3-16'`);
  const q1t = q1.map((r) => r['QUERY PLAN']).join('\n');
  check('getWordTags path uses indexes', /Index/i.test(q1t), q1t.split('\n')[0]?.slice(0, 60));
  const q2 = await sql.unsafe(`EXPLAIN SELECT t.word_id FROM lumen.word_tags t WHERE t.strongs @> ARRAY['G25']::text[]`);
  const q2t = q2.map((r) => r['QUERY PLAN']).join('\n');
  check('getVersesByStrongs uses the GIN index', /idx_word_tags_strongs|Bitmap/i.test(q2t), q2t.split('\n')[0]?.slice(0, 60));
} catch (err) {
  failures++;
  console.error('✗ fatal:', scrub(err.message));
} finally {
  await sql.end();
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
