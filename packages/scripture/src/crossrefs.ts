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
  votes: number | null;
  range_start: string | null;
  range_end: string | null;
  total: number;
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
           COUNT(*) OVER ()::int AS total
         FROM lumen.edges e
         JOIN lumen.verses v ON v.id = e.to_id
         WHERE e.from_id = ${verseId}
           AND e.rel_type = 'CROSS_REF'
           AND e.collection_id = ${opts.collectionId}
           AND (e.metadata->>'range_start' IS NULL OR e.to_id = e.metadata->>'range_start')
         ORDER BY (e.metadata->>'votes')::int DESC NULLS LAST, v.id
         LIMIT ${limit})
        UNION ALL
        (SELECT v.id, v.reference, v.text, 'incoming',
           (e.metadata->>'votes')::int,
           e.metadata->>'range_start',
           e.metadata->>'range_end',
           COUNT(*) OVER ()::int
         FROM lumen.edges e
         JOIN lumen.verses v ON v.id = e.from_id
         WHERE e.to_id = ${verseId}
           AND e.rel_type = 'CROSS_REF'
           AND e.collection_id = ${opts.collectionId}
         ORDER BY (e.metadata->>'votes')::int DESC NULLS LAST, v.id
         LIMIT ${limit})`,
  )) as unknown as CrossRefRow[];

  const totals = { outgoing: 0, incoming: 0 };
  for (const r of rows) totals[r.direction] = r.total;
  return { refs: rows, totals };
}

export interface CrossRefCard {
  verse_id: string;
  /** Display label: "Psalm 148:4–5" for ranges, plain reference otherwise. */
  label: string;
  text: string;
  direction: 'outgoing' | 'incoming';
  votes: number | null;
  range_end: string | null;
}

/**
 * Pure view helper (FM-5/FM-6): one card per (direction, range|verse),
 * vote-sorted descending with null and negative votes last, range labels
 * derived from ids ("…:4–5" same chapter, "… 8:22–9:2" same book,
 * "… ff." across books — 18 rows in the corpus).
 */
export function groupCrossRefs(rows: Array<Omit<CrossRefRow, 'total'> & { total?: number }>): CrossRefCard[] {
  const seen = new Set<string>();
  const cards: CrossRefCard[] = [];
  for (const r of rows) {
    const key = `${r.direction}:${r.range_start ?? r.verse_id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      verse_id: r.range_start ?? r.verse_id,
      label: rangeLabel(r.reference, r.range_start ?? r.verse_id, r.range_end),
      text: r.text,
      direction: r.direction,
      votes: r.votes,
      range_end: r.range_end,
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
