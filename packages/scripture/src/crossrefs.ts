import { sql } from 'drizzle-orm';
import type { Db } from './types';

/**
 * OpenBible / curated cross-references, served from lumen.edges (Postgres —
 * never Neo4j; this call sits in the loader's critical path per COR-2, so it
 * must stay two indexed lookups in one round trip).
 *
 * Row semantics: expanded range edges (one edge per target verse) carry
 * metadata.range_start/range_end. The OUTGOING branch selects only the
 * representative edge (to_id = range_start) so one range = one row and
 * COUNT(*) OVER () is the true card total; the INCOMING branch needs no dedup
 * (each (from, range) contributes exactly one edge whose to_id is this verse).
 * Legacy curated edges carry no votes → NULLS LAST keeps them stable-ordered.
 */

export interface CrossRefRow {
  verse_id: string;
  reference: string;
  text: string;
  direction: 'outgoing' | 'incoming';
  /** null for the curated legacy collection (no vote data) */
  votes: number | null;
  range_start: string | null;
  range_end: string | null;
  /** provenance of the edge (e.g. 'openbible', 'anthropic-batch', 'curated') */
  source: string | null;
}

export interface CrossRefsResult {
  refs: CrossRefRow[];
  totals: { outgoing: number; incoming: number };
}

export async function getCrossReferences(
  db: Db,
  verseId: string,
  opts: { collectionId: string; limitPerDirection?: number },
): Promise<CrossRefsResult> {
  const limit = opts.limitPerDirection ?? 20;
  const rows = (await db.execute(
    sql`(SELECT v.id AS verse_id, v.reference, v.text, 'outgoing' AS direction,
           (e.metadata->>'votes')::int AS votes,
           e.metadata->>'range_start' AS range_start,
           e.metadata->>'range_end' AS range_end,
           e.source AS source,
           COUNT(*) OVER ()::int AS total
         FROM lumen.edges e
         JOIN lumen.verses v ON v.id = e.to_id
         WHERE e.from_id = ${verseId}
           AND e.rel_type = 'CROSS_REF'
           AND e.collection_id = ${opts.collectionId}
           AND (e.metadata->>'range_start' IS NULL OR e.to_id = e.metadata->>'range_start')
         ORDER BY votes DESC NULLS LAST, v.chapter_id, v.verse_number
         LIMIT ${limit})
        UNION ALL
        (SELECT v.id, v.reference, v.text, 'incoming',
           (e.metadata->>'votes')::int AS votes,
           e.metadata->>'range_start',
           e.metadata->>'range_end',
           e.source,
           COUNT(*) OVER ()::int
         FROM lumen.edges e
         JOIN lumen.verses v ON v.id = e.from_id
         WHERE e.to_id = ${verseId}
           AND e.rel_type = 'CROSS_REF'
           AND e.collection_id = ${opts.collectionId}
         ORDER BY votes DESC NULLS LAST, v.chapter_id, v.verse_number
         LIMIT ${limit})`,
  )) as unknown as Array<CrossRefRow & { total: number }>;

  // `total` is transport plumbing for the window count — the contract's
  // CrossRefRow (amendment 11) does not carry it (CAPI-3).
  const totals = { outgoing: 0, incoming: 0 };
  const refs = rows.map(({ total, ...r }) => {
    totals[r.direction] = total;
    return r;
  });
  return { refs, totals };
}

export interface CrossRefCard {
  /** outgoing: the target verse (range start for ranges); incoming: the citing verse */
  verse_id: string;
  /** Display label: "Psalm 148:4–5" for outgoing ranges, plain reference otherwise. */
  label: string;
  text: string;
  direction: 'outgoing' | 'incoming';
  votes: number | null;
  range_end: string | null;
  /** edge provenance ('openbible', 'anthropic-batch', …) — UI labels curated sources */
  source: string | null;
}

/**
 * Pure view helper (FM-5/FM-6): one card per logical reference, vote-sorted
 * descending with null and negative votes last.
 *
 * Direction asymmetry (CCOR-1/CAPI-2 — the Critical this fixes): range
 * metadata always describes the TARGET side of an edge.
 * - OUTGOING rows: verse_id IS the range start (the SQL representative
 *   filter guarantees it), so ranges collapse to one card labeled
 *   "…:4–5" (same chapter), "… 8:22–9:2" (same book), "… ff." (cross-book).
 * - INCOMING rows: verse_id is the CITING verse; range fields describe a
 *   range around the verse being read and are irrelevant to the card's
 *   identity, label, and navigation — they are ignored entirely. Each
 *   distinct citer is its own card.
 */
export function groupCrossRefs(rows: CrossRefRow[]): CrossRefCard[] {
  const seen = new Set<string>();
  const cards: CrossRefCard[] = [];
  for (const r of rows) {
    const isRange = r.direction === 'outgoing' && r.range_start !== null;
    const key = `${r.direction}:${r.verse_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      verse_id: r.verse_id,
      label: isRange ? rangeLabel(r.reference, r.verse_id, r.range_end) : r.reference,
      text: r.text,
      direction: r.direction,
      votes: r.votes,
      range_end: isRange ? r.range_end : null,
      source: r.source ?? null,
    });
  }
  return cards.sort((a, b) => (b.votes ?? Number.NEGATIVE_INFINITY) - (a.votes ?? Number.NEGATIVE_INFINITY));
}

function rangeLabel(reference: string, startId: string, endId: string | null): string {
  if (!endId || endId === startId) return reference;
  const s = splitId(startId);
  const e = splitId(endId);
  if (!s || !e) return reference;
  if (s.book === e.book && s.chapter === e.chapter) return `${reference}–${e.verse}`;
  if (s.book === e.book) return `${reference}–${e.chapter}:${e.verse}`;
  return `${reference} ff.`;
}

function splitId(id: string) {
  const m = id.match(/^(.*)-(\d+)-(\d+)$/);
  if (!m) return null;
  return { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) };
}
