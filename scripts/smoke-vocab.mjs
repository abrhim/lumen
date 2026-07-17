// Vocab drift gate (media-collections 0b): live prod DISTINCTs must be a
// subset of the enforced vocabulary in packages/scripture/src/vocab.ts.
//   node --import tsx scripts/smoke-vocab.mjs
// Run after ANY ingest. Exit 0 clean, 1 fatal (connection/config), 2 drift.
// Vocab entries with no live rows are EXPECTED (planned/reserved — a value
// joins vocab before its writer ships); only unknown LIVE values are drift.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import {
  ENTITY_TYPES,
  PG_REL_TYPES,
  COLLECTION_TIERS,
  COLLECTION_CATEGORIES,
} from '../packages/scripture/src/vocab.ts';

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
  console.error(`FATAL: ${err.message}`);
  process.exit(1);
}

let drift = 0;
function check(label, liveValues, vocab) {
  const allowed = new Set(vocab);
  const unknown = liveValues.filter((v) => !allowed.has(v));
  const dormant = vocab.filter((v) => !liveValues.includes(v));
  if (unknown.length) {
    drift++;
    console.error(`✗ ${label}: live values missing from vocab: ${unknown.join(', ')}`);
  } else {
    console.log(`✓ ${label}: all ${liveValues.length} live values known`);
  }
  if (dormant.length) console.log(`  · dormant (planned/reserved, no rows yet): ${dormant.join(', ')}`);
}

try {
  const et = (await sql`SELECT DISTINCT entity_type FROM lumen.entities ORDER BY 1`).map((r) => r.entity_type);
  const rt = (await sql`SELECT DISTINCT rel_type FROM lumen.edges ORDER BY 1`).map((r) => r.rel_type);
  const tiers = (await sql`SELECT DISTINCT tier FROM lumen.collections ORDER BY 1`).map((r) => r.tier);
  const cats = (await sql`SELECT DISTINCT category FROM lumen.collections ORDER BY 1`).map((r) => r.category);

  check('entities.entity_type', et, ENTITY_TYPES);
  check('edges.rel_type', rt, PG_REL_TYPES);
  check('collections.tier', tiers, COLLECTION_TIERS);
  check('collections.category', cats, COLLECTION_CATEGORIES);
} catch (err) {
  console.error(`FATAL: query failed: ${err.message}`);
  await sql.end();
  process.exit(1);
}

await sql.end();
if (drift) {
  console.error(`\n${drift} vocab drift(s) — reconcile vocab.ts or the offending ingest.`);
  process.exit(2);
}
console.log('\nvocab clean.');
