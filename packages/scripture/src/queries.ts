import { sql } from 'drizzle-orm';
import type { Db } from './types';

/**
 * Canon-spine query layer. Export enumeration (API-2/API-6):
 *
 *  REWRITTEN onto spine tables (signatures + row shapes stable for MCP):
 *    getVerseById, getVerseByReference, getVersesByChapter, getChapterNumbers,
 *    getPassage, searchScriptures, getBooksByVolume, getAllBooks,
 *    getVolumeList, getChapterSummary
 *  NEW (spine):
 *    getBook, getVolume
 *  UNCHANGED (knowledge layer — entities/collections):
 *    getEntity, getChapterArt, getPublicCollectionIds
 *
 * Verse rows keep their historical field names (volume_id, book_id,
 * chapter_number) via aliases so MCP JSON shapes are byte-stable through the
 * transition-column drop (API-1/API-4).
 */

const VERSE_COLUMNS = sql`v.id, b.volume_id, c.book_id, c.number AS chapter_number, v.verse_number, v.text, v.reference`;
const VERSE_SPINE = sql`FROM lumen.verses v
  JOIN lumen.chapters c ON c.id = v.chapter_id
  JOIN lumen.books b ON b.id = c.book_id`;

export async function getVerseById(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT ${VERSE_COLUMNS} ${VERSE_SPINE} WHERE v.id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVerseByReference(db: Db, reference: string) {
  const rows = await db.execute(
    sql`SELECT ${VERSE_COLUMNS} ${VERSE_SPINE} WHERE v.reference = ${reference} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVersesByChapter(db: Db, bookId: string, chapter: number) {
  // chapter id is the verse-id prefix by construction: '{book}-{n}'
  return db.execute(
    sql`SELECT ${VERSE_COLUMNS} ${VERSE_SPINE}
        WHERE v.chapter_id = ${`${bookId}-${chapter}`}
        ORDER BY v.verse_number`,
  );
}

export async function getChapterNumbers(db: Db, bookId: string) {
  return db.execute(
    sql`SELECT number AS chapter_number FROM lumen.chapters
        WHERE book_id = ${bookId}
        ORDER BY number`,
  );
}

export async function getPassage(
  db: Db,
  bookId: string,
  startChapter: number,
  startVerse: number,
  endChapter: number,
  endVerse: number,
  limit: number,
) {
  return db.execute(
    sql`SELECT ${VERSE_COLUMNS} ${VERSE_SPINE}
        WHERE c.book_id = ${bookId}
          AND (c.number, v.verse_number) >= (${startChapter}, ${startVerse})
          AND (c.number, v.verse_number) <= (${endChapter}, ${endVerse})
        ORDER BY c.number, v.verse_number
        LIMIT ${limit}`,
  );
}

export async function searchScriptures(
  db: Db,
  query: string,
  volume?: string,
  limit = 10,
) {
  if (volume) {
    return db.execute(
      sql`SELECT ${VERSE_COLUMNS}, ts_rank(v.search_vector, plainto_tsquery('english', ${query})) AS rank
          ${VERSE_SPINE}
          WHERE v.search_vector @@ plainto_tsquery('english', ${query})
            AND ${volume} = b.volume_id
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );
  }
  return db.execute(
    sql`SELECT ${VERSE_COLUMNS}, ts_rank(v.search_vector, plainto_tsquery('english', ${query})) AS rank
        ${VERSE_SPINE}
        WHERE v.search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}`,
  );
}

export async function getBooksByVolume(db: Db, volumeId: string) {
  return db.execute(
    sql`SELECT id, name, abbrev, sort_order FROM lumen.books
        WHERE volume_id = ${volumeId}
        ORDER BY sort_order`,
  );
}

export async function getAllBooks(db: Db) {
  return db.execute(
    sql`SELECT id, name, abbrev, volume_id, sort_order FROM lumen.books
        ORDER BY sort_order`,
  );
}

export async function getVolumeList(db: Db) {
  return db.execute(
    sql`SELECT id, name, abbrev, tradition, sort_order FROM lumen.volumes
        ORDER BY sort_order`,
  );
}

export async function getBook(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT id, name, abbrev, volume_id, sort_order FROM lumen.books
        WHERE id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVolume(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT id, name, abbrev, tradition, sort_order FROM lumen.volumes
        WHERE id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getChapterSummary(db: Db, bookId: string, chapter: number) {
  // summaries are knowledge-layer entities; looked up by stamped chapter_id,
  // never by id-string convention
  const rows = await db.execute(
    sql`SELECT id, name, description, metadata FROM lumen.entities
        WHERE entity_type = 'chapter_summary'
          AND metadata->>'chapter_id' = ${`${bookId}-${chapter}`}
        LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getChapterArt(db: Db, bookId: string, chapter: number, limit = 24, offset = 0) {
  return db.execute(
    sql`SELECT id, name, metadata FROM lumen.entities
        WHERE entity_type = 'artwork'
          AND metadata->'refs' @> ${JSON.stringify([{ book_id: bookId, chapter }])}::jsonb
        ORDER BY (metadata->>'fame')::numeric DESC NULLS LAST, id
        LIMIT ${limit} OFFSET ${offset}`,
  );
}

/** True total for a chapter's art — one count source for stack labels and
 * gallery pagination (art retro punch item). */
export async function getChapterArtCount(db: Db, bookId: string, chapter: number): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM lumen.entities
        WHERE entity_type = 'artwork'
          AND metadata->'refs' @> ${JSON.stringify([{ book_id: bookId, chapter }])}::jsonb`,
  )) as { n: number }[];
  return rows[0]?.n ?? 0;
}

export async function getPublicCollectionIds(db: Db) {
  const rows = await db.execute(
    sql`SELECT id FROM lumen.collections WHERE public = true ORDER BY id`,
  );
  return (rows as { id: string }[]).map((r) => r.id);
}

export async function getEntity(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT id, entity_type, name, description, metadata, source FROM lumen.entities
        WHERE id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}
