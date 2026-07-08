// Art → graph-citizen edge materialization (art-graph feature).
//   node scripts/materialize-art-edges.mjs [--dry-run]
//
// Reads artwork ENTITY metadata (already in prod) and materializes into
// lumen.edges: DEPICTS art→chapter (every ref), DEPICTS art→verse (verse-level
// refs, one edge per verse with range metadata — openbible pattern), FEATURES
// art→person via the curated ART_PERSON_MAP below. ONE transaction; DELETE is
// against lumen.edges ONLY, scoped collection_id='art' AND rel_type IN
// ('DEPICTS','FEATURES'). Refs that fail chapter/verse bounds are skipped and
// counted under a 2% abort cap (amendment 5) — the 16 apocryphal Daniel 13–14
// refs are the documented expected skips. Exit codes: 0 success, 1 fatal.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { assertSessionMode, scrub } from './migrate-canon-spine.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_CAP = 0.02; // whole-run ratio of skipped refs over total refs

/**
 * Curated character-slug → person-entity-id map (amendment 6). Rule:
 * name-explicit ids beat raw edge degree (person:jacob-1 has 1,087 edges but
 * is the BoM Jacob; the Genesis patriarch is jacob-patriarch-1); otherwise a
 * slug maps only when one candidate clearly dominates by degree. Probed live
 * 2026-07-07. Deliberately unmapped (no clear winner, reported at run time):
 * joseph (Genesis vs Nazareth), noah (flood-Noah entity absent), daniel
 * (120 vs 78 degree — ambiguous).
 */
export const ART_PERSON_MAP = {
  jesus: 'jesus-christ',
  david: 'david-1',
  jacob: 'jacob-patriarch-1',
  moses: 'person:moses-1',
  john_baptist: 'john-the-baptist-1',
  abraham: 'abraham-1',
  judas: 'judas-iscariot-1',
  mary: 'mary-1',
  mary_magdalene: 'mary-magdalene-1',
  elijah: 'elijah-tishbite',
  job: 'person:job-1',
  solomon: 'solomon-1',
  peter: 'peter-1',
  esther: 'esther-1',
  jonah: 'person:jonah-1',
  paul: 'paul-1',
  isaac: 'isaac-1',
  eve: 'eve-1',
  ruth: 'person:ruth-1',
  adam: 'adam-1',
  samson: 'samson-1',
};

/**
 * Pure edge builder (harness-tested). Lookups injected:
 * - chapterExists(chapterId) → boolean
 * - verseExists(verseId) → boolean
 * - personExists(personId) → boolean
 * Returns { edges, skipped, unmappedSlugs }. Dedupe: one edge per
 * (from, to, rel_type); duplicate chapter refs merge is_primary with OR
 * (primary wins regardless of order); overlapping verse refs union their
 * range metadata (min start, max end).
 */
export function buildArtEdges(artworks, { chapterExists, verseExists, personExists }) {
  const byKey = new Map();
  const skipped = [];
  const unmappedSlugs = [];

  const put = (edge) => {
    const key = `${edge.from_id}\t${edge.to_id}\t${edge.rel_type}`;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, edge); return; }
    prev.metadata.is_primary = Boolean(prev.metadata.is_primary || edge.metadata.is_primary);
    if (edge.metadata.range_start && prev.metadata.range_start) {
      // union overlapping ranges: numeric compare on the verse suffix
      const vnum = (id) => Number(id.match(/-(\d+)$/)?.[1] ?? 0);
      if (vnum(edge.metadata.range_start) < vnum(prev.metadata.range_start)) prev.metadata.range_start = edge.metadata.range_start;
      if (vnum(edge.metadata.range_end) > vnum(prev.metadata.range_end)) prev.metadata.range_end = edge.metadata.range_end;
    }
  };

  for (const art of artworks) {
    for (const ref of art.metadata?.refs ?? []) {
      const chapterId = `${ref.book_id}-${ref.chapter}`;
      if (!chapterExists(chapterId)) {
        skipped.push(`${art.id} -> ${chapterId} (chapter)`);
        continue;
      }
      put({
        from_id: art.id, to_id: chapterId, rel_type: 'DEPICTS',
        metadata: { is_primary: ref.is_primary ?? false, range_start: null, range_end: null },
      });
      if (ref.verse_start != null) {
        const end = ref.verse_end ?? ref.verse_start; // single-verse cite (COR-1)
        if (end < ref.verse_start) {
          skipped.push(`${art.id} -> ${chapterId}:${ref.verse_start}-${end} (inverted)`);
          continue;
        }
        const ids = [];
        let ok = true;
        for (let v = ref.verse_start; v <= end; v++) {
          const vid = `${chapterId}-${v}`;
          if (!verseExists(vid)) { ok = false; break; }
          ids.push(vid);
        }
        if (!ok) {
          skipped.push(`${art.id} -> ${chapterId}:${ref.verse_start}-${end} (verse bounds)`);
          continue;
        }
        const rangeStart = ids.length > 1 ? ids[0] : null;
        const rangeEnd = ids.length > 1 ? ids[ids.length - 1] : null;
        for (const vid of ids) {
          put({
            from_id: art.id, to_id: vid, rel_type: 'DEPICTS',
            metadata: { is_primary: ref.is_primary ?? false, range_start: rangeStart, range_end: rangeEnd },
          });
        }
      }
    }
    for (const slug of art.metadata?.biblical_character ?? []) {
      const personId = ART_PERSON_MAP[slug];
      if (!personId) { unmappedSlugs.push(slug); continue; }
      if (!personExists(personId)) { skipped.push(`${art.id} -> ${personId} (person missing)`); continue; }
      put({
        from_id: art.id, to_id: personId, rel_type: 'FEATURES',
        metadata: { is_primary: false, range_start: null, range_end: null },
      });
    }
  }
  return { edges: [...byKey.values()], skipped, unmappedSlugs: [...new Set(unmappedSlugs)] };
}

const log = (event, data = {}) => console.log(JSON.stringify({ event, ...data }));

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const t0 = Date.now();
  log('art_edges_start', { startedAt: new Date().toISOString(), dryRun });

  let sql;
  try {
    const envPath = join(ROOT, '.env');
    if (!existsSync(envPath)) throw new Error('repo-root .env with admin DATABASE_URL required');
    const url = readFileSync(envPath, 'utf8').match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim();
    if (!url) throw new Error('DATABASE_URL not found in repo-root .env');
    if (/:6543\b/.test(url)) throw new Error('session-mode connection required (port 5432)');
    const require = createRequire(import.meta.url);
    const postgres = require('postgres');
    sql = postgres(url, { prepare: false, max: 1 });
  } catch (err) {
    log('art_edges_fatal', { message: scrub(err.message) });
    process.exit(1);
  }

  let exitCode = 0;
  try {
    await assertSessionMode(sql);

    const chapters = new Set((await sql`SELECT id FROM lumen.chapters`).map((r) => r.id));
    const verseCounts = new Map(
      (await sql`SELECT chapter_id, count(*)::int AS n FROM lumen.verses GROUP BY chapter_id`).map((r) => [r.chapter_id, r.n]),
    );
    const persons = new Set(
      (await sql`SELECT id FROM lumen.entities WHERE entity_type = 'person'`).map((r) => r.id),
    );
    const artworks = await sql`SELECT id, metadata FROM lumen.entities WHERE entity_type = 'artwork'`;
    const totalRefs = artworks.reduce((n, a) => n + (a.metadata?.refs?.length ?? 0), 0);
    log('art_source_loaded', { artworks: artworks.length, refs: totalRefs });

    const verseExists = (vid) => {
      const m = vid.match(/^(.*)-(\d+)$/);
      if (!m) return false;
      const count = verseCounts.get(m[1]);
      return count !== undefined && Number(m[2]) >= 1 && Number(m[2]) <= count;
    };
    const { edges, skipped, unmappedSlugs } = buildArtEdges(artworks, {
      chapterExists: (id) => chapters.has(id),
      verseExists,
      personExists: (id) => persons.has(id),
    });

    const skipRatio = totalRefs === 0 ? 0 : skipped.length / totalRefs;
    log('art_edges_skipped_refs', { count: skipped.length, ratio: Number(skipRatio.toFixed(5)), sample: skipped.slice(0, 10) });
    log('art_edges_unmapped_slugs', { count: unmappedSlugs.length, sample: unmappedSlugs.slice(0, 10) });
    if (skipRatio >= SKIP_CAP) throw new Error(`skip ratio ${(skipRatio * 100).toFixed(2)}% breaches the ${SKIP_CAP * 100}% cap`);

    const byRelType = {};
    for (const e of edges) byRelType[e.rel_type] = (byRelType[e.rel_type] ?? 0) + 1;

    let deletedCount = 0;
    await sql.begin(async (tx) => {
      // explicit collection visibility + self-correcting fields (SEC-4 precedent)
      await tx`UPDATE lumen.collections SET public = true WHERE id = 'art'`;
      const deleted = await tx`
        DELETE FROM lumen.edges
        WHERE collection_id = 'art' AND rel_type IN ('DEPICTS', 'FEATURES')`;
      deletedCount = deleted.count;
      for (let i = 0; i < edges.length; i += 5000) {
        const batch = edges.slice(i, i + 5000);
        await tx`
          INSERT INTO lumen.edges (from_id, to_id, rel_type, collection_id, metadata, source)
          SELECT r.from_id, r.to_id, r.rel_type, 'art', r.metadata, 'learnofchrist'
          FROM jsonb_to_recordset(${tx.json(batch)}) AS r(from_id text, to_id text, rel_type text, metadata jsonb)`;
      }
      const [orph] = await tx`
        SELECT count(*)::int AS n FROM lumen.edges e
        WHERE e.collection_id = 'art'
          AND (NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.from_id)
            OR NOT EXISTS (SELECT 1 FROM lumen.nodes nn WHERE nn.id = e.to_id))`;
      log('invariant_check', { name: 'art_zero_orphan_endpoints', expected: 0, actual: orph.n, pass: orph.n === 0 });
      if (orph.n !== 0) throw new Error('invariant failed: art_zero_orphan_endpoints');

      await tx`
        INSERT INTO lumen.migration_state (key, value)
        VALUES ('art-edges-materialize', ${tx.json({ at: new Date().toISOString(), inserted: edges.length, deleted: deletedCount, byRelType })})
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()`;

      if (dryRun) throw new Error('DRY_RUN_ROLLBACK');
    }).catch((e) => {
      if (e.message === 'DRY_RUN_ROLLBACK') log('dry_run_rollback', { note: 'all checks passed, nothing committed' });
      else throw e;
    });

    log('art_edges_done', { dryRun, deleted: deletedCount, inserted: edges.length, byRelType, elapsedMs: Date.now() - t0 });
  } catch (err) {
    exitCode = 1;
    log('art_edges_fatal', { message: scrub(err.message), elapsedMs: Date.now() - t0 });
  } finally {
    await sql.end();
    process.exit(exitCode);
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
