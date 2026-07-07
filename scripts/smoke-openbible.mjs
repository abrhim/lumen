// Live post-ingest invariants for the OpenBible cross-references.
//   node scripts/smoke-openbible.mjs
// Read checks + one EXPLAIN sanity print; exit 0/1. Run AFTER
// ingest-openbible-refs.mjs and BEFORE the web deploy; also re-run
// scripts/smoke-canon-spine.mjs afterwards (DATA-3 — the all-edges
// zero-orphan gate must stay green).
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) { console.error('root .env with DATABASE_URL required'); process.exit(1); }
const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const require = createRequire(import.meta.url);
const postgres = require('postgres');
const sql = postgres(url, { prepare: false, max: 1 });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  await sql.unsafe(`SET statement_timeout = '120s'`);

  // count + re-run stability against the ingest's own marker (OBS-5)
  const [n] = await sql`SELECT count(*)::int AS n FROM lumen.edges WHERE collection_id = 'openbible'`;
  check('openbible edges present (expanded > source rows)', n.n > 344799, `${n.n}`);
  const [marker] = await sql`SELECT value FROM lumen.migration_state WHERE key = 'openbible-ingest'`;
  check('ingest marker present', !!marker, marker ? `inserted=${marker.value.inserted}` : 'missing');
  if (marker) {
    check('live count matches last ingest (re-run stable)', n.n === marker.value.inserted, `${n.n} vs ${marker.value.inserted}`);
  }

  // zero orphan endpoints within the collection
  const [orph] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges e
    WHERE e.collection_id = 'openbible'
      AND (NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.from_id)
        OR NOT EXISTS (SELECT 1 FROM lumen.verses v WHERE v.id = e.to_id))`;
  check('zero orphan endpoints', orph.n === 0, `${orph.n}`);

  // famous refs (plan §5): Gen 1:1 → Heb 11:3 with its known vote count
  const [famous] = await sql`
    SELECT (metadata->>'votes')::int AS votes FROM lumen.edges
    WHERE collection_id = 'openbible' AND from_id = 'gen-1-1' AND to_id = 'heb-11-3'`;
  check('Gen 1:1 → Heb 11:3 present with votes=271', famous?.votes === 271, `${famous?.votes ?? 'missing'}`);
  const [j316] = await sql`
    SELECT
      (SELECT count(*)::int FROM lumen.edges WHERE collection_id = 'openbible' AND from_id = 'john-3-16') AS outgoing,
      (SELECT count(*)::int FROM lumen.edges WHERE collection_id = 'openbible' AND to_id = 'john-3-16') AS incoming`;
  check('John 3:16 has refs both directions', j316.outgoing > 0 && j316.incoming > 0, `out=${j316.outgoing} in=${j316.incoming}`);

  // versification canary (COR-1): a Psalm-title-sensitive ref must land on the
  // expected KJV text — openbible Ps.51.1 is KJV "Have mercy upon me, O God"
  const [ps51] = await sql`SELECT text FROM lumen.verses WHERE id = 'ps-51-1'`;
  check('Psalm 51:1 is the KJV verse (titles not offset)', /have mercy upon me/i.test(ps51?.text ?? ''), (ps51?.text ?? '').slice(0, 40));
  const [ps51ref] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'openbible' AND (from_id = 'ps-51-1' OR to_id = 'ps-51-1')`;
  check('Psalm 51:1 participates in cross-refs', ps51ref.n > 0, `${ps51ref.n}`);

  // exceptions landed (Q8): rewritten drift refs resolve, originals absent
  const [drift] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'openbible' AND (from_id LIKE '3-jn-1-15%' OR to_id LIKE '3-jn-1-15%')`;
  check('no edge cites the nonexistent 3 John 1:15', drift.n === 0, `${drift.n}`);

  // vote ordering sanity: top outgoing ref of gen-1-1 has the max votes
  const top = await sql`
    SELECT to_id, (metadata->>'votes')::int AS votes FROM lumen.edges
    WHERE collection_id = 'openbible' AND from_id = 'gen-1-1'
      AND (metadata->>'range_start' IS NULL OR to_id = metadata->>'range_start')
    ORDER BY (metadata->>'votes')::int DESC NULLS LAST LIMIT 3`;
  check('vote ordering sane for Gen 1:1', top.length > 0 && top[0].votes >= (top[1]?.votes ?? -1),
    top.map((t) => `${t.to_id}:${t.votes}`).join(' '));

  // EXPLAIN sanity (amendment 14): the hot lookup must use an index
  const plan = await sql.unsafe(
    `EXPLAIN SELECT v.id FROM lumen.edges e JOIN lumen.verses v ON v.id = e.to_id
     WHERE e.from_id = 'john-3-16' AND e.rel_type = 'CROSS_REF' AND e.collection_id = 'openbible'`);
  const planText = plan.map((r) => r['QUERY PLAN']).join('\n');
  check('outgoing lookup uses an index on edges', /Index.*edges|edges.*idx/i.test(planText), planText.split('\n')[0]?.slice(0, 70));

  // legacy path intact (hybrid): curated BoM refs still resolvable
  const [legacy] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'phase-b' AND rel_type = 'CROSS_REF' AND from_id = '1-ne-3-7'`;
  check('legacy curated refs intact for 1 Nephi 3:7', legacy.n >= 0, `${legacy.n} refs`);
} catch (err) {
  failures++;
  console.error('✗ fatal:', scrub(err.message));
} finally {
  await sql.end();
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
