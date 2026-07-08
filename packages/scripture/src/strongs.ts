import { sql } from 'drizzle-orm';
import type { Db } from './types';

/**
 * Word-level Strong's queries (strongs feature). Postgres-only, loader
 * critical path — one round trip each (COR-2 discipline).
 */

export interface WordTagEntry {
  strongs_no: string;
  translit: string | null;
  gloss: string | null;
  definition: string | null;
}

export interface WordTagRow {
  word_id: string;
  position: number;
  char_start: number;
  char_end: number;
  strongs: string[];
  morph: string | null;
  /** lexicon entries in strongs[] order (WITH ORDINALITY — CD-7); a missing
   * lexicon row degrades to a number-only entry, never drops (FM-10) */
  entries: WordTagEntry[];
}

export async function getWordTags(db: Db, verseId: string): Promise<WordTagRow[]> {
  return (await db.execute(
    sql`SELECT w.id AS word_id, w.position, w.char_start, w.char_end,
          t.strongs, t.morph,
          json_agg(
            json_build_object(
              'strongs_no', s.no,
              'translit', l.translit,
              'gloss', l.gloss,
              'definition', l.definition
            ) ORDER BY s.ord
          ) AS entries
        FROM lumen.word_tags t
        JOIN lumen.words w ON w.id = t.word_id
        CROSS JOIN LATERAL unnest(t.strongs) WITH ORDINALITY AS s(no, ord)
        LEFT JOIN lumen.strongs_lexicon l ON l.strongs_no = s.no
        WHERE w.verse_id = ${verseId}
        GROUP BY w.id, w.position, w.char_start, w.char_end, t.strongs, t.morph
        ORDER BY w.position`,
  )) as unknown as WordTagRow[];
}

export interface StrongsVerseRow {
  verse_id: string;
  reference: string;
  text: string;
}

export async function getVersesByStrongs(db: Db, strongsNo: string, limit = 20): Promise<StrongsVerseRow[]> {
  return (await db.execute(
    sql`SELECT DISTINCT v.id AS verse_id, v.reference, v.text, v.chapter_id, v.verse_number
        FROM lumen.word_tags t
        JOIN lumen.words w ON w.id = t.word_id
        JOIN lumen.verses v ON v.id = w.verse_id
        WHERE t.strongs @> ARRAY[${strongsNo}]::text[]
        ORDER BY v.chapter_id, v.verse_number
        LIMIT ${limit}`,
  )) as unknown as StrongsVerseRow[];
}
