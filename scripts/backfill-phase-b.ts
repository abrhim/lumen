/**
 * Lumen Phase B — Import AI-generated entities from Neo4j JSON export into Postgres.
 *
 * Reads the Neo4j JSON dump (nodes.json + edges.json) and inserts Phase B
 * AI-extracted entities (persons, places, principles, symbols, chapter summaries,
 * cross-references, eras, events) into Supabase Postgres.
 *
 * Skips node types handled by Phase A: LM_Verse, LM_Book, LM_Volume, LM_Chapter,
 * LM_StrongsWord, LM_NaveTopic, LM_JstReading.
 *
 * Usage:
 *   npx tsx scripts/backfill-phase-b.ts --dry-run
 *   npx tsx scripts/backfill-phase-b.ts --write
 *
 * Env vars (reads from root .env):
 *   DATABASE_URL (single connection string, preferred)
 *   — or individual: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
 */

import * as fs from 'fs';
import * as path from 'path';
import pg from 'pg';

// ── Paths ──────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, 'data/neo4j-export');
const NODES_PATH = path.join(EXPORT_DIR, 'nodes.json');
const EDGES_PATH = path.join(EXPORT_DIR, 'edges.json');

// ── Label → entity_type mapping ────────────────────────────────────────

const LABEL_MAP: Record<string, string> = {
  LM_Person: 'person',
  LM_Place: 'place',
  LM_Principle: 'principle',
  LM_Symbol: 'symbol',
  LM_ChapterSummary: 'chapter_summary',
  LM_Era: 'era',
  LM_Event: 'event',
};

const SKIP_LABELS = new Set([
  'LM_Verse', 'LM_Book', 'LM_Volume', 'LM_Chapter',
  'LM_StrongsWord', 'LM_NaveTopic', 'LM_JstReading',
]);

// ── Property keys to exclude from metadata ─────────────────────────────

const EXCLUDED_PROPS = new Set(['id', 'name', 'description', '_labels', '_element_id']);

// ── Node normalization ─────────────────────────────────────────────────
// Some node types use non-standard field names for name/description.

function extractName(node: Record<string, any>, label: string): string {
  if (label === 'LM_Symbol') return node.symbol || node.id;
  if (label === 'LM_ChapterSummary') return node.chapter_id ? `Summary: ${node.chapter_id}` : node.id;
  return node.name || node.id;
}

function extractDescription(node: Record<string, any>, label: string): string | null {
  if (label === 'LM_Symbol') return node.antitype || null;
  if (label === 'LM_ChapterSummary') return node.summary || null;
  if (label === 'LM_Principle') return node.definition || node.description || null;
  return node.description || null;
}

/** Build metadata from all properties not consumed by id/name/description. */
function extractMetadata(
  node: Record<string, any>,
  label: string,
): Record<string, unknown> {
  // Keys already used as name or description (varies by type)
  const consumedKeys = new Set(EXCLUDED_PROPS);

  if (label === 'LM_Symbol') {
    consumedKeys.add('symbol');   // used as name
    consumedKeys.add('antitype'); // used as description
  } else if (label === 'LM_ChapterSummary') {
    consumedKeys.add('chapter_id'); // used in name
    consumedKeys.add('summary');    // used as description
  } else if (label === 'LM_Principle') {
    consumedKeys.add('definition'); // used as description
  }

  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (!consumedKeys.has(key) && value !== null && value !== undefined) {
      meta[key] = value;
    }
  }
  return meta;
}

// ── Batch insert helpers ───────────────────────────────────────────────

interface EntityRow {
  id: string;
  entityType: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  source: string;
  collectionId: string;
}

interface EdgeRow {
  fromId: string;
  toId: string;
  relType: string;
  collectionId: string;
  metadata: Record<string, unknown>;
  source: string;
}

async function batchInsertEntities(
  pool: pg.Pool,
  entities: EntityRow[],
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((e, idx) => {
      const base = idx * 8;
      const searchText = [e.name, e.description].filter(Boolean).join(' ');
      values.push(
        e.id, e.entityType, e.name, e.description,
        JSON.stringify(e.metadata), e.source, e.collectionId, searchText,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, to_tsvector('english', $${base + 8}))`;
    });
    await pool.query(
      `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, description = EXCLUDED.description,
         metadata = EXCLUDED.metadata, source = EXCLUDED.source,
         collection_id = EXCLUDED.collection_id,
         search_vector = EXCLUDED.search_vector`,
      values,
    );
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= entities.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, entities.length)} / ${entities.length} entities`);
    }
  }
}

async function batchInsertEdges(
  pool: pg.Pool,
  edges: EdgeRow[],
): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders = batch.map((e, idx) => {
      const base = idx * 6;
      values.push(
        e.fromId, e.toId, e.relType,
        e.collectionId, JSON.stringify(e.metadata), e.source,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6})`;
    });
    await pool.query(
      `INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
       VALUES ${placeholders.join(', ')}`,
      values,
    );
    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= edges.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, edges.length)} / ${edges.length} edges`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--write');

  if (dryRun) {
    console.log('+===========================================+');
    console.log('|  DRY RUN -- no data will be written       |');
    console.log('|  Use --write to actually import            |');
    console.log('+===========================================+');
  }

  // Load env from root .env
  const envPath = path.resolve(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match && !process.env[match[1].trim()]) {
        process.env[match[1].trim()] = match[2].trim();
      }
    }
    console.log(`Loaded env from ${envPath}`);
  }

  // ── Read and filter nodes ──────────────────────────────────────────

  console.log('\n=== Reading nodes.json ===\n');
  const allNodes: Record<string, any>[] = JSON.parse(
    fs.readFileSync(NODES_PATH, 'utf-8'),
  );
  console.log(`  Total nodes in export: ${allNodes.length}`);

  // Filter to Phase B entity types
  const entityRows: EntityRow[] = [];
  const countsByType: Record<string, number> = {};
  let skippedCount = 0;

  for (const node of allNodes) {
    const labels: string[] = node._labels || [];
    const primaryLabel = labels[0];

    if (!primaryLabel) continue;

    if (SKIP_LABELS.has(primaryLabel)) {
      skippedCount++;
      continue;
    }

    const entityType = LABEL_MAP[primaryLabel];
    if (!entityType) {
      // Unknown label — skip silently
      continue;
    }

    const name = extractName(node, primaryLabel);
    const description = extractDescription(node, primaryLabel);
    const metadata = extractMetadata(node, primaryLabel);

    entityRows.push({
      id: node.id,
      entityType,
      name,
      description,
      metadata,
      source: 'anthropic-batch',
      collectionId: 'phase-b',
    });

    countsByType[entityType] = (countsByType[entityType] || 0) + 1;
  }

  // Deduplicate by ID (Neo4j export can have multiple labels per node)
  const seenIds = new Set<string>();
  const dedupedRows: EntityRow[] = [];
  for (const row of entityRows) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      dedupedRows.push(row);
    }
  }
  const dupeCount = entityRows.length - dedupedRows.length;
  entityRows.length = 0;
  entityRows.push(...dedupedRows);

  console.log(`  Skipped (Phase A types): ${skippedCount}`);
  if (dupeCount > 0) console.log(`  Deduplicated: ${dupeCount} duplicate IDs removed`);
  console.log(`  Phase B entities to insert: ${entityRows.length}`);
  console.log('  By type:');
  for (const [type, count] of Object.entries(countsByType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // ── Read edges ─────────────────────────────────────────────────────

  console.log('\n=== Reading edges.json ===\n');
  const allEdges: Record<string, any>[] = JSON.parse(
    fs.readFileSync(EDGES_PATH, 'utf-8'),
  );
  console.log(`  Total edges in export: ${allEdges.length}`);

  const edgeRows: EdgeRow[] = allEdges.map((edge) => ({
    fromId: edge.from_id,
    toId: edge.to_id,
    relType: edge.rel_type,
    collectionId: 'phase-b',
    metadata: edge.props || {},
    source: 'anthropic-batch',
  }));

  const edgesByType: Record<string, number> = {};
  for (const edge of allEdges) {
    edgesByType[edge.rel_type] = (edgesByType[edge.rel_type] || 0) + 1;
  }
  console.log('  By rel_type:');
  for (const [type, count] of Object.entries(edgesByType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // ── Dry run: stop here ─────────────────────────────────────────────

  if (dryRun) {
    console.log('\n=== Dry Run Summary ===\n');
    console.log(`  Would insert ${entityRows.length} entities`);
    console.log(`  Would insert ${edgeRows.length} edges`);
    console.log('\n  Run with --write to execute.');
    return;
  }

  // ── Build pool and connect ─────────────────────────────────────────

  let poolConfig: pg.PoolConfig;

  if (process.env.DATABASE_URL) {
    const url = new URL(process.env.DATABASE_URL);
    poolConfig = {
      host: url.hostname,
      port: parseInt(url.port || '5432'),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ''),
      ssl: { rejectUnauthorized: false },
      max: 5,
    };
  } else {
    poolConfig = {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME || 'postgres',
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 5,
    };
  }

  const pool = new pg.Pool(poolConfig);

  try {
    // Ensure the phase-b collection row exists
    await pool.query(`
      INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage)
      VALUES ('phase-b', 'Phase B AI Entities', 'AI-extracted entities and relationships', 'enrichment', 'ai-generated', 'anthropic-batch', 'proprietary', 'pg')
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Insert entities ────────────────────────────────────────────────

    console.log(`\n=== Inserting ${entityRows.length} entities ===\n`);
    await batchInsertEntities(pool, entityRows);

    // ── Insert edges (delete-then-insert for idempotent re-runs) ──────

    console.log(`\n=== Inserting ${edgeRows.length} edges ===\n`);
    console.log('  Deleting existing phase-b edges...');
    const deleteResult = await pool.query(
      `DELETE FROM lumen.edges WHERE collection_id = 'phase-b'`,
    );
    console.log(`  Deleted ${deleteResult.rowCount} existing edges.`);

    console.log('  Inserting edges...');
    await batchInsertEdges(pool, edgeRows);

    // ── Verification ───────────────────────────────────────────────────

    console.log('\n=== Verification ===\n');

    const entityCount = await pool.query(
      `SELECT entity_type, COUNT(*) AS cnt
       FROM lumen.entities
       WHERE collection_id = 'phase-b'
       GROUP BY entity_type
       ORDER BY cnt DESC`,
    );
    let totalEntities = 0;
    for (const row of entityCount.rows) {
      console.log(`  entities/${row.entity_type}: ${row.cnt}`);
      totalEntities += parseInt(row.cnt);
    }
    console.log(`  entities total: ${totalEntities}`);

    const edgeCount = await pool.query(
      `SELECT rel_type, COUNT(*) AS cnt
       FROM lumen.edges
       WHERE collection_id = 'phase-b'
       GROUP BY rel_type
       ORDER BY cnt DESC`,
    );
    let totalEdges = 0;
    for (const row of edgeCount.rows) {
      console.log(`  edges/${row.rel_type}: ${row.cnt}`);
      totalEdges += parseInt(row.cnt);
    }
    console.log(`  edges total: ${totalEdges}`);

    console.log('\nPhase B backfill complete.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Phase B backfill failed:', err);
  process.exit(1);
});
