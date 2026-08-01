/**
 * Lumen Phase B — Import AI-generated entities from Neo4j JSON export into Postgres.
 *
 * Reads the Neo4j JSON dump (nodes.json + edges.json) and upserts Phase B
 * AI-extracted entities (persons, places, principles, symbols, chapter summaries,
 * cross-references, eras, events) into Supabase Postgres.
 *
 * Skips node types handled by Phase A: LM_Verse, LM_Book, LM_Volume, LM_Chapter,
 * LM_StrongsWord, LM_NaveTopic, LM_JstReading.
 *
 * Merge-aware rewrite (remediation v2 item 3) — delete-then-insert is GONE:
 *  - Entities upsert ON CONFLICT (id), preserving curated metadata.neo4j_id
 *    (the resolveGraphId contract; load.mjs mentions-preserving philosophy).
 *  - Edges collapse (from_id, to_id, rel_type) duplicates IN MEMORY first —
 *    the export contains both members of every historical dup pair, and a
 *    straight upsert would self-conflict in-batch (PG error 21000) — then
 *    upsert ON CONFLICT on idx_edges_phaseb_unique, preserving merged
 *    metadata (sources/reason/relationship are never clobbered back to
 *    single-source).
 *  - The renames ledger (scripts/entity-renames.json, shared with
 *    migrate-entity-rename.mjs) is applied to entity ids AND edge endpoints
 *    before upsert, so ledgered old ids are never re-minted from the export.
 *  - Startup assert: idx_edges_phaseb_unique exists, else exit 2 immediately
 *    (fail-closed until migrate-phaseb-dedupe.mjs lands).
 *  - --tx-rollback runs the ENTIRE load on one connection inside
 *    BEGIN..ROLLBACK (drives the rolled-back live-tx pin harness).
 *
 * Usage:
 *   npx tsx scripts/backfill-phase-b.ts --dry-run       # default
 *   npx tsx scripts/backfill-phase-b.ts --write          # single tx, COMMIT
 *   npx tsx scripts/backfill-phase-b.ts --tx-rollback    # single tx, ROLLBACK
 *
 * Env vars (reads from root .env):
 *   DATABASE_URL (single connection string, preferred)
 *   — or individual: DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL
 *   RENAMES_LEDGER (optional path override for the renames ledger — lets the
 *   pin harness inject a scoped ledger without touching the shared file)
 *
 * Exit 0 ok, 1 fatal, 2 fail-closed gate / post-load invariant failure.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import pg from 'pg';
// Shared DB-merge shape — the in-memory collapse must produce exactly what
// migrate-phaseb-dedupe.mjs's MERGE_UPDATE_SQL produced in the database.
// (That module keeps its entrypoint free of top-level await for this import.)
import {
  buildMergedMetadata,
  MERGED_SOURCES,
  PHASEB_INDEX_NAME,
} from './migrate-phaseb-dedupe.mjs';

// ── Paths ──────────────────────────────────────────────────────────────

// This file has import syntax and the package declares no "type", so node
// parses it as ESM — where __dirname does not exist. Same idiom as
// export-neo4j.mjs.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, '..');
const EXPORT_DIR = path.join(ROOT, 'data/neo4j-export');
const NODES_PATH = path.join(EXPORT_DIR, 'nodes.json');
const EDGES_PATH = path.join(EXPORT_DIR, 'edges.json');
const LEDGER_PATH = process.env.RENAMES_LEDGER || path.join(ROOT, 'scripts/entity-renames.json');

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

// ── Row shapes ─────────────────────────────────────────────────────────

export interface EntityRow {
  id: string;
  entityType: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  source: string;
  collectionId: string;
}

export interface EdgeRow {
  fromId: string;
  toId: string;
  relType: string;
  collectionId: string;
  metadata: Record<string, any>;
  source: string;
}

/** Anything pg.Pool / pg.Client / a test fake can satisfy. */
export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount: number | null }>;
}

// ── Renames ledger (shared contract with migrate-entity-rename.mjs) ────

// entity ids are lowercase slugs; ':' allowed for `{type}:{id}` namespaced ids
const ID_PATTERN = /^[a-z0-9][a-z0-9:-]*$/;

/**
 * Parse + validate the renames ledger ([{from,to}]). null text (missing
 * file) == empty ledger. Mirrors migrate-entity-rename.mjs validateLedger
 * semantics: slug ids only, from !== to, no duplicate from/to, no chains.
 */
export function parseRenamesLedger(text: string | null): Map<string, string> {
  if (text === null) return new Map();
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    throw new Error('renames ledger: invalid JSON');
  }
  if (!Array.isArray(entries)) throw new Error('renames ledger must be a JSON array');
  const map = new Map<string, string>();
  const targets = new Set<string>();
  entries.forEach((e: any, i: number) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) {
      throw new Error(`renames ledger entry ${i}: not an object`);
    }
    for (const k of ['from', 'to']) {
      if (typeof e[k] !== 'string' || !ID_PATTERN.test(e[k])) {
        throw new Error(`renames ledger entry ${i}: ${k} must be a slug id, got ${JSON.stringify(e[k])}`);
      }
    }
    if (e.from === e.to) throw new Error(`renames ledger entry ${i}: from === to`);
    if (map.has(e.from)) throw new Error(`renames ledger entry ${i}: duplicate from '${e.from}'`);
    if (targets.has(e.to)) throw new Error(`renames ledger entry ${i}: duplicate target '${e.to}'`);
    map.set(e.from, e.to);
    targets.add(e.to);
  });
  for (const [from, to] of map) {
    if (map.has(to)) throw new Error(`renames ledger: chained rename '${from}' -> '${to}' -> '${map.get(to)}'`);
  }
  return map;
}

/** Single-hop ledger application (chains are refused at parse time). */
export function applyRename(ledger: Map<string, string>, id: string): string {
  return ledger.get(id) ?? id;
}

/**
 * Final PG id for an export node: ledger first (a ledgered old id is never
 * re-minted), then `{type}:{id}` collision namespacing against Phase A ids
 * and already-assigned finals.
 */
export function assignFinalEntityId(
  nodeId: string,
  entityType: string,
  ledger: Map<string, string>,
  takenIds: Set<string>,
  usedFinalIds: Set<string>,
): { finalId: string; ledgered: boolean; namespaced: boolean } {
  const ledgeredId = applyRename(ledger, nodeId);
  let finalId = ledgeredId;
  let namespaced = false;
  if (takenIds.has(finalId) || usedFinalIds.has(finalId)) {
    finalId = `${entityType}:${ledgeredId}`;
    namespaced = true;
    while (takenIds.has(finalId) || usedFinalIds.has(finalId)) finalId += '+';
  }
  return { finalId, ledgered: ledgeredId !== nodeId, namespaced };
}

/**
 * Edge endpoint remap: the (label, id) → final-id map (already
 * ledger-applied for phase-b nodes) wins; endpoints that never appear as
 * export nodes go through the ledger directly.
 */
export function remapEndpoint(
  finalIdByLabelId: Map<string, string>,
  ledger: Map<string, string>,
  label: string,
  id: string,
): string {
  const mapped = finalIdByLabelId.get(`${label}|${id}`);
  if (mapped !== undefined) return mapped;
  return applyRename(ledger, id);
}

// ── In-memory dedupe collapse ──────────────────────────────────────────

/** Curated member survives, matching the DB merge's survivor choice. */
export function pickSurvivorIndex(group: EdgeRow[]): number {
  const isCurated = (m: any) =>
    m?.source === 'bible-bom-curated' ||
    (Array.isArray(m?.sources) && m.sources.includes('bible-bom-curated'));
  const i = group.findIndex((r) => isCurated(r.metadata));
  return i >= 0 ? i : 0;
}

/**
 * Collapse (from_id, to_id, rel_type) duplicates before batching. The export
 * contains both members of every historical dup pair; without this the
 * upsert self-conflicts in-batch (PG error 21000 "cannot affect row a second
 * time"). Merge shape == the DB merge (buildMergedMetadata): survivor =
 * curated member, gains reason/relationship + metadata.sources.
 */
export function collapseEdgeRows(rows: EdgeRow[]): {
  rows: EdgeRow[];
  groupsCollapsed: number;
  rowsMerged: number;
} {
  const byKey = new Map<string, EdgeRow[]>();
  const order: string[] = [];
  for (const r of rows) {
    const k = `${r.fromId}\u0000${r.toId}\u0000${r.relType}\u0000${r.collectionId}`;
    const group = byKey.get(k);
    if (group) group.push(r);
    else {
      byKey.set(k, [r]);
      order.push(k);
    }
  }
  const out: EdgeRow[] = [];
  let groupsCollapsed = 0;
  let rowsMerged = 0;
  for (const k of order) {
    const group = byKey.get(k)!;
    if (group.length === 1) {
      out.push(group[0]);
      continue;
    }
    groupsCollapsed += 1;
    rowsMerged += group.length - 1;
    const si = pickSurvivorIndex(group);
    const survivor = group[si];
    let metadata: Record<string, any> = { ...survivor.metadata };
    for (let i = 0; i < group.length; i += 1) {
      if (i === si) continue;
      metadata = buildMergedMetadata(metadata, group[i].metadata);
    }
    out.push({ ...survivor, metadata });
  }
  return { rows: out, groupsCollapsed, rowsMerged };
}

// ── Upsert statement builders (pure, exported for tests) ───────────────

/**
 * Entity upsert. DO UPDATE preserves the curated metadata.neo4j_id (item 7
 * rename stamps; resolveGraphId contract) over anything in the export —
 * object-guarded like load.mjs so string-scalar metadata cannot poison the
 * merge. The WHERE guard means a non-phase-b conflict row is SKIPPED, never
 * hijacked (the caller compares rowCount to batch size and fails on drops).
 */
export function buildEntityUpsertStatement(batch: EntityRow[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = batch.map((e, idx) => {
    const base = idx * 8;
    const searchText = [e.name, e.description].filter(Boolean).join(' ');
    values.push(
      e.id, e.entityType, e.name, e.description,
      JSON.stringify(e.metadata), e.source, e.collectionId, searchText,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6}, $${base + 7}, to_tsvector('english', $${base + 8}))`;
  });
  const text = `INSERT INTO lumen.entities (id, entity_type, name, description, metadata, source, collection_id, search_vector)
VALUES ${tuples.join(', ')}
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description,
  metadata = EXCLUDED.metadata || (CASE WHEN jsonb_typeof(lumen.entities.metadata) = 'object'
    THEN jsonb_strip_nulls(jsonb_build_object('neo4j_id', lumen.entities.metadata->'neo4j_id'))
    ELSE '{}'::jsonb END),
  source = EXCLUDED.source, collection_id = EXCLUDED.collection_id,
  search_vector = EXCLUDED.search_vector
WHERE lumen.entities.collection_id = 'phase-b'`;
  return { text, values };
}

/**
 * Edge upsert, arbitrated on idx_edges_phaseb_unique. DO UPDATE preserves
 * the migration's merged provenance: an existing sources array, reason, and
 * relationship always win over the incoming row (never clobbered back to
 * single-source), object-guarded against string-scalar metadata.
 */
export function buildEdgeUpsertStatement(batch: EdgeRow[]): { text: string; values: unknown[] } {
  const values: unknown[] = [];
  const tuples = batch.map((e, idx) => {
    if (e.collectionId !== 'phase-b') {
      // the partial-index arbiter only protects phase-b rows — anything else
      // here would insert unguarded duplicates
      throw new Error(`edge upsert requires collection_id='phase-b', got '${e.collectionId}'`);
    }
    const base = idx * 6;
    values.push(
      e.fromId, e.toId, e.relType,
      e.collectionId, JSON.stringify(e.metadata), e.source,
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}::jsonb, $${base + 6})`;
  });
  const text = `INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
VALUES ${tuples.join(', ')}
ON CONFLICT (from_id, to_id, rel_type) WHERE collection_id = 'phase-b'
DO UPDATE SET
  source = EXCLUDED.source,
  metadata = EXCLUDED.metadata || (CASE WHEN jsonb_typeof(lumen.edges.metadata) = 'object'
    THEN jsonb_strip_nulls(jsonb_build_object(
      'sources', CASE WHEN jsonb_typeof(lumen.edges.metadata->'sources') = 'array'
                      THEN lumen.edges.metadata->'sources' END,
      'reason', lumen.edges.metadata->'reason',
      'relationship', lumen.edges.metadata->'relationship'))
    ELSE '{}'::jsonb END)`;
  return { text, values };
}

// ── Startup gate ───────────────────────────────────────────────────────

export const PHASEB_INDEX_EXISTS_SQL = `
SELECT EXISTS (SELECT 1 FROM pg_indexes
  WHERE schemaname = 'lumen' AND indexname = '${PHASEB_INDEX_NAME}') AS pass`;

export async function phasebIndexExists(q: Queryable): Promise<boolean> {
  const res = await q.query(PHASEB_INDEX_EXISTS_SQL);
  return res.rows[0]?.pass === true;
}

// ── Batch upsert runners ───────────────────────────────────────────────

export class LoadInvariantError extends Error {}

export async function batchUpsertEntities(q: Queryable, entities: EntityRow[]): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < entities.length; i += BATCH_SIZE) {
    const batch = entities.slice(i, i + BATCH_SIZE);
    const { text, values } = buildEntityUpsertStatement(batch);
    const res = await q.query(text, values);
    if (res.rowCount !== batch.length) {
      // a dropped row means the DO UPDATE WHERE guard skipped a non-phase-b
      // conflict — the collision-namespacing failed; abort, never hijack
      throw new LoadInvariantError(
        `entity batch at ${i}: ${res.rowCount} rows affected, expected ${batch.length} (non-phase-b id conflict?)`,
      );
    }
    if ((i + BATCH_SIZE) % 2000 === 0 || i + BATCH_SIZE >= entities.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, entities.length)} / ${entities.length} entities`);
    }
  }
}

export async function batchUpsertEdges(q: Queryable, edges: EdgeRow[]): Promise<void> {
  const BATCH_SIZE = 500;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    const { text, values } = buildEdgeUpsertStatement(batch);
    const res = await q.query(text, values);
    if (res.rowCount !== batch.length) {
      throw new LoadInvariantError(
        `edge batch at ${i}: ${res.rowCount} rows affected, expected ${batch.length}`,
      );
    }
    if ((i + BATCH_SIZE) % 5000 === 0 || i + BATCH_SIZE >= edges.length) {
      console.log(`    ${Math.min(i + BATCH_SIZE, edges.length)} / ${edges.length} edges`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const txRollback = args.includes('--tx-rollback');
  const write = args.includes('--write');
  if (txRollback && write) {
    console.error('--write and --tx-rollback are mutually exclusive');
    process.exit(1);
  }
  const dryRun = !write && !txRollback;

  if (dryRun) {
    console.log('+===========================================+');
    console.log('|  DRY RUN -- no data will be written       |');
    console.log('|  Use --write to actually import            |');
    console.log('+===========================================+');
  }
  if (txRollback) {
    console.log('+===========================================+');
    console.log('|  TX-ROLLBACK -- full load inside          |');
    console.log('|  BEGIN..ROLLBACK on a single connection   |');
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

  // ── Renames ledger (missing file == empty ledger) ──────────────────

  const ledgerText = fs.existsSync(LEDGER_PATH) ? fs.readFileSync(LEDGER_PATH, 'utf-8') : null;
  const ledger = parseRenamesLedger(ledgerText);
  console.log(JSON.stringify({ event: 'ledger_loaded', path: LEDGER_PATH, entries: ledger.size, present: ledgerText !== null }));

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
      max: 1, // single connection: --tx-rollback/--write run one tx on one session
      statement_timeout: 600_000,
    };
  } else {
    poolConfig = {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT || '5432'),
      user: process.env.DB_USER!,
      password: process.env.DB_PASSWORD!,
      database: process.env.DB_NAME || 'postgres',
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
      max: 1,
      statement_timeout: 600_000,
    };
  }

  const pool = new pg.Pool(poolConfig);
  let client: pg.PoolClient | null = null;
  let inTx = false;

  try {
    // ── Startup assert: merge index exists — fail-closed until the dedupe
    // migration lands (its absence would let the upsert re-create dups) ──
    if (!(await phasebIndexExists(pool))) {
      console.error(
        JSON.stringify({ event: 'halt', reason: `${PHASEB_INDEX_NAME} missing — run migrate-phaseb-dedupe.mjs first (fail-closed)` }),
      );
      process.exit(2);
    }

  // ── Fetch IDs already owned by Phase A data ────────────────────────
  // Neo4j namespaces ids by label (LM_Person {id:'alma-2'} coexists with
  // LM_Chapter {id:'alma-2'}); the entities table has a global id PK, so
  // colliding Phase B ids must be namespaced as `{type}:{id}`.

  const takenIds = new Set<string>();
  const ownedRes = await pool.query(
    `SELECT id FROM lumen.entities WHERE collection_id IS DISTINCT FROM 'phase-b'`,
  );
  for (const r of ownedRes.rows) takenIds.add(r.id);
  const verseRes = await pool.query(`SELECT id FROM lumen.verses`);
  for (const r of verseRes.rows) takenIds.add(r.id);
  console.log(`\nLoaded ${takenIds.size} Phase A ids for collision detection.`);

  // ── Ledger gate: a ledgered old id still occupying lumen.entities means
  // the rename migration has not run — loading now would leave BOTH ids
  // resident (the upsert never deletes). Fail closed on write paths. ──
  if (ledger.size > 0) {
    const froms = [...ledger.keys()];
    const occupied = await pool.query(
      `SELECT id FROM lumen.entities WHERE id = ANY($1::text[])`,
      [froms],
    );
    if (occupied.rows.length > 0) {
      const ids = occupied.rows.map((r: any) => r.id);
      if (dryRun) {
        console.log(JSON.stringify({ event: 'ledger_gate_warning', occupied_from_ids: ids, note: 'write mode would halt — run migrate-entity-rename.mjs first' }));
      } else {
        console.error(JSON.stringify({ event: 'halt', reason: 'ledger_from_ids_still_occupied', ids }));
        process.exit(2);
      }
    }
  }

  // ── Read and filter nodes ──────────────────────────────────────────

  console.log('\n=== Reading nodes.json ===\n');
  const allNodes: Record<string, any>[] = JSON.parse(
    fs.readFileSync(NODES_PATH, 'utf-8'),
  );
  console.log(`  Total nodes in export: ${allNodes.length}`);

  // Filter to Phase B entity types, assigning collision-free final ids.
  // finalIdByLabelId maps `${label}|${neo4jId}` → the id stored in PG, so
  // edge endpoints (which carry from_label/to_label) can be remapped exactly.
  const entityRows: EntityRow[] = [];
  const countsByType: Record<string, number> = {};
  const finalIdByLabelId = new Map<string, string>();
  const usedFinalIds = new Set<string>();
  let skippedCount = 0;
  let namespacedCount = 0;
  let trueDupeCount = 0;
  let ledgerRenamedEntities = 0;

  for (const node of allNodes) {
    const labels: string[] = node._labels || [];
    const primaryLabel = labels[0];

    if (!primaryLabel) continue;

    const key = `${primaryLabel}|${node.id}`;

    if (SKIP_LABELS.has(primaryLabel)) {
      skippedCount++;
      finalIdByLabelId.set(key, node.id); // Phase A rows keep their ids
      continue;
    }

    const entityType = LABEL_MAP[primaryLabel];
    if (!entityType) {
      // Unknown label — skip silently
      continue;
    }

    if (finalIdByLabelId.has(key)) {
      trueDupeCount++; // same label + same id exported twice
      continue;
    }

    // renames ledger BEFORE collision handling: a ledgered export id maps to
    // its renamed PG id and the old id is never re-minted
    const { finalId, ledgered, namespaced } = assignFinalEntityId(
      node.id, entityType, ledger, takenIds, usedFinalIds,
    );
    if (ledgered) ledgerRenamedEntities++;
    if (namespaced) namespacedCount++;
    finalIdByLabelId.set(key, finalId);
    usedFinalIds.add(finalId);

    const name = extractName(node, primaryLabel);
    const description = extractDescription(node, primaryLabel);
    const metadata = extractMetadata(node, primaryLabel);
    // resolveGraphId contract: any id that differs from the graph's carries
    // the original as neo4j_id (rename stamp matches migrate-entity-rename)
    if (finalId !== node.id) metadata.neo4j_id = node.id;

    entityRows.push({
      id: finalId,
      entityType,
      name,
      description,
      metadata,
      source: 'anthropic-batch',
      collectionId: 'phase-b',
    });

    countsByType[entityType] = (countsByType[entityType] || 0) + 1;
  }

  console.log(`  Skipped (Phase A types): ${skippedCount}`);
  if (trueDupeCount > 0) console.log(`  True duplicates (same label+id) skipped: ${trueDupeCount}`);
  if (namespacedCount > 0) console.log(`  Namespaced (id collision with another type): ${namespacedCount}`);
  if (ledgerRenamedEntities > 0) console.log(`  Renamed via ledger: ${ledgerRenamedEntities}`);
  console.log(`  Phase B entities to upsert: ${entityRows.length}`);
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

  // Remap endpoints through the (label, id) → final id map — which is
  // already ledger-applied — and put unmapped endpoints (Phase A ids that
  // never appear as nodes) through the ledger too. Keep the Neo4j labels in
  // metadata — with colliding ids they are the only way to tell which
  // entity an endpoint refers to.
  let remappedEndpoints = 0;
  let ledgerRenamedEndpoints = 0;
  const edgeRows: EdgeRow[] = allEdges.map((edge) => {
    const mapEndpoint = (label: string, id: string): string => {
      const final = remapEndpoint(finalIdByLabelId, ledger, label, id);
      if (final !== id && !finalIdByLabelId.has(`${label}|${id}`)) ledgerRenamedEndpoints++;
      return final;
    };
    const fromFinal = mapEndpoint(edge.from_label, edge.from_id);
    const toFinal = mapEndpoint(edge.to_label, edge.to_id);
    if (fromFinal !== edge.from_id || toFinal !== edge.to_id) remappedEndpoints++;
    return {
      fromId: fromFinal,
      toId: toFinal,
      relType: edge.rel_type,
      collectionId: 'phase-b',
      metadata: { ...(edge.props || {}), from_label: edge.from_label, to_label: edge.to_label },
      source: 'anthropic-batch',
    };
  });
  if (remappedEndpoints > 0) console.log(`  Edges with remapped endpoints: ${remappedEndpoints}`);
  if (ledgerRenamedEndpoints > 0) console.log(`  Edge endpoints renamed via ledger: ${ledgerRenamedEndpoints}`);

  const edgesByType: Record<string, number> = {};
  for (const edge of allEdges) {
    edgesByType[edge.rel_type] = (edgesByType[edge.rel_type] || 0) + 1;
  }
  console.log('  By rel_type:');
  for (const [type, count] of Object.entries(edgesByType).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${type}: ${count}`);
  }

  // ── In-memory dedupe collapse (must precede batching — see docstring) ──

  const collapse = collapseEdgeRows(edgeRows);
  const dedupedEdges = collapse.rows;
  console.log(JSON.stringify({
    event: 'edge_collapse',
    rows_in: edgeRows.length,
    rows_out: dedupedEdges.length,
    groups_collapsed: collapse.groupsCollapsed,
    rows_merged: collapse.rowsMerged,
  }));
  {
    // hard guarantee against in-batch self-conflict (PG error 21000)
    const seen = new Set<string>();
    for (const e of dedupedEdges) {
      const k = `${e.fromId}\u0000${e.toId}\u0000${e.relType}`;
      if (seen.has(k)) throw new Error(`collapse failed: duplicate tuple survived (${e.fromId}, ${e.toId}, ${e.relType})`);
      seen.add(k);
    }
  }

  // ── Dry run: stop here ─────────────────────────────────────────────

  if (dryRun) {
    console.log('\n=== Dry Run Summary ===\n');
    console.log(`  Would upsert ${entityRows.length} entities`);
    console.log(`  Would upsert ${dedupedEdges.length} edges (${collapse.rowsMerged} merged in-memory)`);
    console.log('\n  Run with --write to execute.');
    return;
  }

    // ── Single connection, single tx: COMMIT (--write) / ROLLBACK (--tx-rollback) ──

    client = await pool.connect();
    await client.query('BEGIN');
    inTx = true;
    await client.query(`SET LOCAL statement_timeout = '600s'`);

    // Ensure the phase-b collection row exists
    await client.query(`
      INSERT INTO lumen.collections (id, name, description, tier, category, provenance, license, storage)
      VALUES ('phase-b', 'Phase B AI Entities', 'AI-extracted entities and relationships', 'enrichment', 'ai-generated', 'anthropic-batch', 'proprietary', 'pg')
      ON CONFLICT (id) DO NOTHING
    `);

    // ── Upsert entities (merge-aware; no DELETE) ───────────────────────

    console.log(`\n=== Upserting ${entityRows.length} entities ===\n`);
    await batchUpsertEntities(client, entityRows);

    // ── Upsert edges (merge-aware; no DELETE) ──────────────────────────

    console.log(`\n=== Upserting ${dedupedEdges.length} edges ===\n`);
    await batchUpsertEdges(client, dedupedEdges);

    // ── Verification (inside the tx — sees the uncommitted state) ──────

    console.log('\n=== Verification ===\n');

    const entityCount = await client.query(
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

    const edgeCount = await client.query(
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

    // ── Post-load invariants (abort → ROLLBACK → exit 2) ───────────────

    const mergedSourcesJson = JSON.stringify(MERGED_SOURCES);
    const dupRes = await client.query(
      `SELECT count(*)::int AS n FROM (
         SELECT 1 FROM lumen.edges WHERE collection_id = 'phase-b'
         GROUP BY from_id, to_id, rel_type HAVING count(*) > 1) d`,
    );
    const dupGroups = Number(dupRes.rows[0].n);
    const stampedRes = await client.query(
      `SELECT count(*)::int AS n FROM lumen.edges
       WHERE collection_id = 'phase-b' AND metadata->'sources' = $1::jsonb`,
      [mergedSourcesJson],
    );
    const curatedRes = await client.query(
      `SELECT count(*)::int AS n FROM lumen.edges
       WHERE collection_id = 'phase-b' AND metadata->>'source' = 'bible-bom-curated'
         AND metadata->'sources' = $1::jsonb`,
      [mergedSourcesJson],
    );
    let strayFromIds = 0;
    if (ledger.size > 0) {
      const strayRes = await client.query(
        `SELECT count(*)::int AS n FROM lumen.entities WHERE id = ANY($1::text[])`,
        [[...ledger.keys()]],
      );
      strayFromIds = Number(strayRes.rows[0].n);
    }
    console.log(JSON.stringify({
      event: 'load_verify',
      mode: txRollback ? 'tx-rollback' : 'write',
      entities_total: totalEntities,
      edges_total: totalEdges,
      dup_groups: dupGroups,
      sources_stamped_rows: Number(stampedRes.rows[0].n),
      curated_provenance_rows: Number(curatedRes.rows[0].n),
      ledger_from_ids_present: strayFromIds,
    }));
    if (dupGroups !== 0) {
      throw new LoadInvariantError(`post-load: ${dupGroups} duplicate (from,to,rel_type) groups in phase-b`);
    }
    if (strayFromIds !== 0) {
      throw new LoadInvariantError(`post-load: ${strayFromIds} ledgered old ids re-minted`);
    }

    if (txRollback) {
      await client.query('ROLLBACK');
      inTx = false;
      console.log(JSON.stringify({ event: 'tx_rolled_back', mode: 'tx-rollback' }));
      console.log('\nPhase B tx-rollback exercise complete (nothing committed).');
    } else {
      await client.query('COMMIT');
      inTx = false;
      console.log(JSON.stringify({ event: 'tx_committed', mode: 'write' }));
      console.log('\nPhase B backfill complete.');
    }
  } catch (err) {
    if (client && inTx) {
      try {
        await client.query('ROLLBACK');
        console.log(JSON.stringify({ event: 'tx_rolled_back', reason: 'error' }));
      } catch { /* connection may already be gone */ }
    }
    if (err instanceof LoadInvariantError) {
      console.error('INVARIANT:', err.message);
      process.exitCode = 2;
      return;
    }
    throw err;
  } finally {
    if (client) client.release();
    await pool.end();
  }
}

// ESM has no require.main === module; compare this file's URL to argv[1] so
// importing it for tests stays side-effect free while direct runs still work.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Phase B backfill failed:', err);
    process.exit(1);
  });
}
