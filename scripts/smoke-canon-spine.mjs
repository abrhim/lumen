// Live post-migration invariants for canon-spine (P3). On full pass, persists
// the marker that gates P4 (--drop-transition-columns).
//   node scripts/smoke-canon-spine.mjs
// Runs read checks with the admin DSN (root .env DATABASE_URL); exit 0/1.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(ROOT, '.env');
if (!existsSync(envPath)) { console.error('root .env with DATABASE_URL required'); process.exit(1); }
const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
const require = createRequire(import.meta.url);
const postgres = require(join(ROOT, 'apps/web/node_modules/postgres'));
const sql = postgres(url, { prepare: false, max: 1 });

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

try {
  // counts + structure
  const [v] = await sql`SELECT count(*)::int AS n FROM lumen.verses`;
  const [c] = await sql`SELECT count(*)::int AS n FROM lumen.chapters`;
  const [pairs] = await sql`
    SELECT count(*)::int AS n FROM (SELECT DISTINCT chapter_id FROM lumen.verses) s`;
  const [vols] = await sql`SELECT count(*)::int AS n FROM lumen.volumes`;
  const [books] = await sql`SELECT count(*)::int AS n FROM lumen.books`;
  check('verses intact', v.n === 41995, `${v.n}`);
  check('chapters match distinct verse chapters', c.n === pairs.n, `${c.n} vs ${pairs.n}`);
  check('5 volumes', vols.n === 5, `${vols.n}`);
  check('books incl. dc', books.n >= 87, `${books.n}`);

  const [dc] = await sql`SELECT id, name FROM lumen.books WHERE id = 'dc'`;
  check('dc book row exists (the D&C class)', !!dc, dc?.name ?? 'missing');

  // FK integrity — zero orphans
  const [orphV] = await sql`
    SELECT count(*)::int AS n FROM lumen.verses v
    LEFT JOIN lumen.chapters ch ON ch.id = v.chapter_id WHERE ch.id IS NULL`;
  check('zero verse→chapter orphans', orphV.n === 0, `${orphV.n}`);
  const [orphC] = await sql`
    SELECT count(*)::int AS n FROM lumen.chapters ch
    LEFT JOIN lumen.books b ON b.id = ch.book_id WHERE b.id IS NULL`;
  check('zero chapter→book orphans', orphC.n === 0, `${orphC.n}`);

  // summaries resolve (COR-9)
  const [orphS] = await sql`
    SELECT count(*)::int AS n FROM lumen.entities e
    WHERE e.entity_type = 'chapter_summary'
      AND NOT EXISTS (SELECT 1 FROM lumen.chapters c2 WHERE c2.id = e.metadata->>'chapter_id')`;
  check('zero orphan summaries', orphS.n === 0, `${orphS.n}`);

  // exhaustive edge-endpoint anti-join against lumen.nodes (DATA-5)
  const [orphFrom] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges e
    LEFT JOIN lumen.nodes nn ON nn.id = e.from_id WHERE nn.id IS NULL`;
  const [orphTo] = await sql`
    SELECT count(*)::int AS n FROM lumen.edges e
    LEFT JOIN lumen.nodes nn ON nn.id = e.to_id WHERE nn.id IS NULL`;
  check('every edge from-endpoint resolves in lumen.nodes', orphFrom.n === 0, `${orphFrom.n}`);
  check('every edge to-endpoint resolves in lumen.nodes', orphTo.n === 0, `${orphTo.n}`);

  // words (present only after ingest-words has run)
  const [w] = await sql`SELECT count(*)::int AS n FROM lumen.words`;
  if (w.n > 0) {
    const [zero] = await sql`
      SELECT count(*)::int AS n FROM lumen.verses v
      WHERE NOT EXISTS (SELECT 1 FROM lumen.words wd WHERE wd.verse_id = v.id)`;
    check('zero token-less verses', zero.n === 0, `${zero.n} of ${v.n}`);
    const bad = await sql`
      SELECT wd.id FROM lumen.words wd JOIN lumen.verses vv ON vv.id = wd.verse_id
      WHERE substring(vv.text FROM wd.char_start + 1 FOR wd.char_end - wd.char_start) <> wd.surface
      LIMIT 5`;
    check('offsets round-trip in SQL (sampled full corpus)', bad.length === 0,
      bad.length ? JSON.stringify(bad) : `${w.n} words verified`);
  } else {
    console.log('· words table empty — ingest-words not yet run (checks skipped)');
  }

  // latency sanity (UX-8, right-sized): hottest query under a loose ceiling
  const t = Date.now();
  await sql`SELECT id, text FROM lumen.verses WHERE chapter_id = '1-ne-3' ORDER BY verse_number`;
  check('hot chapter query latency sane', Date.now() - t < 500, `${Date.now() - t}ms`);

  if (failures === 0 && w.n > 0) {
    await sql`
      INSERT INTO lumen.migration_state (key, value)
      VALUES ('canon-spine-p3-verified', ${sql.json({ at: new Date().toISOString() })})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;
    console.log('· P3 marker persisted — P4 (--drop-transition-columns) is now unlocked');
  } else if (failures === 0) {
    console.log('· P3 marker withheld until words ingest completes');
  }
} catch (err) {
  failures++;
  console.error('✗ fatal:', String(err.message).replace(/\/\/[^@\s]*@/g, '//<redacted>@'));
} finally {
  await sql.end();
  console.log(failures === 0 ? 'SMOKE PASS' : `SMOKE FAIL (${failures})`);
  process.exit(failures === 0 ? 0 : 1);
}
