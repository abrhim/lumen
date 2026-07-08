// Live post-materialization invariants for art-graph edges.
//   node scripts/smoke-art-edges.mjs
// Run AFTER materialize-art-edges.mjs; then re-run smoke-canon-spine.mjs
// (the all-edges zero-orphan gate must stay green). Exit 0/1.
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

  const byRel = await sql`
    SELECT rel_type, count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'art' GROUP BY rel_type ORDER BY rel_type`;
  const rels = Object.fromEntries(byRel.map((r) => [r.rel_type, r.n]));
  check('DEPICTS edges present (chapters + verses)', (rels.DEPICTS ?? 0) > 4000, `${rels.DEPICTS ?? 0}`);
  check('FEATURES edges present', (rels.FEATURES ?? 0) > 300, `${rels.FEATURES ?? 0}`);
  check('no unexpected rel_types in the art collection', byRel.every((r) => ['DEPICTS', 'FEATURES'].includes(r.rel_type)));

  const [marker] = await sql`SELECT value FROM lumen.migration_state WHERE key = 'art-edges-materialize'`;
  check('run marker present', !!marker, marker ? `inserted=${marker.value.inserted}` : 'missing');
  if (marker) {
    const [total] = await sql`SELECT count(*)::int AS n FROM lumen.edges WHERE collection_id = 'art'`;
    check('live count matches last run (re-run stable)', total.n === marker.value.inserted, `${total.n} vs ${marker.value.inserted}`);
  }

  const [orph] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges e
    WHERE e.collection_id = 'art'
      AND (NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.from_id)
        OR NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.to_id))`;
  check('zero orphan endpoints', orph.n === 0, `${orph.n}`);

  // pinned canaries (live-probed 2026-07-07, amendment 8)
  const [simeon] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'art' AND rel_type = 'DEPICTS'
      AND from_id = 'art:rembrandt-simeon-in-the-temple-1669' AND to_id = 'luke-2'`;
  check('Rembrandt Simeon DEPICTS luke-2', simeon.n === 1, `${simeon.n}`);
  const durer = await sql`
    SELECT to_id, metadata->>'range_start' AS rs, metadata->>'range_end' AS re
    FROM lumen.edges
    WHERE collection_id = 'art' AND rel_type = 'DEPICTS'
      AND from_id = 'art:durer-title-page' AND to_id LIKE 'rev-1-%' ORDER BY to_id`;
  check('Dürer title page has per-verse DEPICTS rev-1-1..3 with range metadata',
    durer.length === 3 && durer.every((r) => r.rs === 'rev-1-1' && r.re === 'rev-1-3'),
    durer.map((r) => r.to_id).join(' '));
  const [caravaggio] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'art' AND rel_type = 'FEATURES'
      AND from_id = 'art:caravaggio-calling-of-saint-matthew' AND to_id = 'jesus-christ'`;
  check('Caravaggio Calling of St Matthew FEATURES jesus-christ', caravaggio.n === 1, `${caravaggio.n}`);

  // documented expected skips: apocryphal Daniel 13-14 refs never became edges
  const [dan] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges
    WHERE collection_id = 'art' AND (to_id LIKE 'dan-13%' OR to_id LIKE 'dan-14%')`;
  check('no edges to apocryphal Daniel 13-14', dan.n === 0, `${dan.n}`);
} catch (err) {
  failures++;
  console.error('✗ fatal:', scrub(err.message));
} finally {
  await sql.end();
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
