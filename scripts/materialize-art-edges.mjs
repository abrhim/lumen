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
 * Book-context gates for polysemous slugs (CCD-1, live-verified): the same
 * tag string names DIFFERENT people depending on the artwork — "judas" is
 * Maccabeus on 3/18 works, "jacob" is poetic Israel on ~13/30. A gated slug
 * maps only when the artwork carries a ref in a book where the mapped person
 * is the referent; otherwise it's context-skipped and reported.
 */
export const ART_PERSON_BOOK_GATE = {
  jacob: ['gen'],
  judas: ['matt', 'mark', 'luke', 'john', 'acts'],
};

/**
 * Pure edge builder (harness-tested). Lookups injected: chapterExists,
 * verseExists, personExists. Returns { edges, skipped, partial,
 * skippedPersons, contextSkipped, unmappedSlugs }:
 * - skipped: whole-ref misses (unknown chapter) — the 2% cap's numerator
 * - partial: chapter edge kept but verse bounds failed (CCD-3)
 * - contextSkipped: gated slugs whose artwork lacks a qualifying ref (CCD-1)
 * Verse refs per (artwork, chapter) are interval-merged BEFORE emission so
 * every edge in an overlap group carries identical range metadata (CCD-2,
 * also covers single-verse ∪ range, CSC-4); chapter edges merge is_primary
 * with OR regardless of ref order.
 */
export function buildArtEdges(artworks, { chapterExists, verseExists, personExists }) {
  const edges = [];
  const skipped = [];
  const partial = [];
  const skippedPersons = [];
  const contextSkipped = [];
  const unmappedSlugs = [];

  for (const art of artworks) {
    const refs = art.metadata?.refs ?? [];
    const chapterPrimary = new Map(); // chapterId → is_primary (OR-merged)
    const intervals = new Map(); // chapterId → [{start, end, primary}]

    for (const ref of refs) {
      const chapterId = `${ref.book_id}-${ref.chapter}`;
      if (!chapterExists(chapterId)) {
        skipped.push(`${art.id} -> ${chapterId} (chapter)`);
        continue;
      }
      chapterPrimary.set(chapterId, Boolean(chapterPrimary.get(chapterId) || ref.is_primary));
      if (ref.verse_start != null) {
        const end = ref.verse_end ?? ref.verse_start; // single-verse cite (COR-1)
        if (end < ref.verse_start) {
          partial.push(`${art.id} -> ${chapterId}:${ref.verse_start}-${end} (inverted)`);
          continue;
        }
        if (!intervals.has(chapterId)) intervals.set(chapterId, []);
        intervals.get(chapterId).push({ start: ref.verse_start, end, primary: Boolean(ref.is_primary) });
      }
    }

    for (const [chapterId, isPrimary] of chapterPrimary) {
      edges.push({
        from_id: art.id, to_id: chapterId, rel_type: 'DEPICTS',
        metadata: { is_primary: isPrimary, range_start: null, range_end: null },
      });
    }

    for (const [chapterId, list] of intervals) {
      // merge OVERLAPPING intervals (adjacent-but-disjoint refs stay separate
      // citations) so the whole group shares one consistent range (CCD-2)
      list.sort((a, b) => a.start - b.start);
      const merged = [];
      for (const iv of list) {
        const last = merged[merged.length - 1];
        if (last && iv.start <= last.end) {
          last.end = Math.max(last.end, iv.end);
          last.primary = last.primary || iv.primary;
        } else {
          merged.push({ ...iv });
        }
      }
      for (const m of merged) {
        const ids = [];
        let ok = true;
        for (let v = m.start; v <= m.end; v++) {
          const vid = `${chapterId}-${v}`;
          if (!verseExists(vid)) { ok = false; break; }
          ids.push(vid);
        }
        if (!ok) {
          partial.push(`${art.id} -> ${chapterId}:${m.start}-${m.end} (verse bounds)`);
          continue;
        }
        const rangeStart = ids.length > 1 ? ids[0] : null;
        const rangeEnd = ids.length > 1 ? ids[ids.length - 1] : null;
        for (const vid of ids) {
          edges.push({
            from_id: art.id, to_id: vid, rel_type: 'DEPICTS',
            metadata: { is_primary: m.primary, range_start: rangeStart, range_end: rangeEnd },
          });
        }
      }
    }

    // FEATURES — note: works with character tags but zero refs still get
    // FEATURES edges (6 live works; valid graph citizens, CCD-4) unless the
    // slug is gated (a gate can never pass without refs).
    const refBooks = new Set(refs.map((r) => r.book_id));
    const seenPersons = new Set();
    for (const slug of art.metadata?.biblical_character ?? []) {
      const personId = ART_PERSON_MAP[slug];
      if (!personId) { unmappedSlugs.push(slug); continue; }
      const gate = ART_PERSON_BOOK_GATE[slug];
      if (gate && !gate.some((b) => refBooks.has(b))) {
        contextSkipped.push(`${art.id}:${slug}`);
        continue;
      }
      if (!personExists(personId)) { skippedPersons.push(`${art.id} -> ${personId}`); continue; }
      if (seenPersons.has(personId)) continue;
      seenPersons.add(personId);
      edges.push({
        from_id: art.id, to_id: personId, rel_type: 'FEATURES',
        metadata: { is_primary: false, range_start: null, range_end: null },
      });
    }
  }
  return { edges, skipped, partial, skippedPersons, contextSkipped, unmappedSlugs: [...new Set(unmappedSlugs)] };
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
    const { edges, skipped, partial, skippedPersons, contextSkipped, unmappedSlugs } = buildArtEdges(artworks, {
      chapterExists: (id) => chapters.has(id),
      verseExists,
      personExists: (id) => persons.has(id),
    });

    // cap counts only WHOLE-ref misses; partial (chapter kept) and person-side
    // skips are reported under their own events (CCD-3/CSC-3)
    const skipRatio = totalRefs === 0 ? 0 : skipped.length / totalRefs;
    log('art_edges_skipped_refs', { count: skipped.length, ratio: Number(skipRatio.toFixed(5)), sample: skipped.slice(0, 10) });
    log('art_edges_partial_refs', { count: partial.length, sample: partial.slice(0, 10) });
    log('art_edges_unmapped_slugs', { count: unmappedSlugs.length, sample: unmappedSlugs.slice(0, 10) });
    log('art_edges_context_skipped', { count: contextSkipped.length, sample: contextSkipped.slice(0, 10) });
    log('art_edges_missing_persons', { count: skippedPersons.length, sample: skippedPersons.slice(0, 10) });
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
