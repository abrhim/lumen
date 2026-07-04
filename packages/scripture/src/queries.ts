import { sql } from 'drizzle-orm';
import type { Db } from './types';

const VERSE_COLUMNS = sql`id, volume_id, book_id, chapter_number, verse_number, text, reference`;

export async function getVerseById(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT ${VERSE_COLUMNS} FROM lumen.verses WHERE id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVerseByReference(db: Db, reference: string) {
  const rows = await db.execute(
    sql`SELECT ${VERSE_COLUMNS} FROM lumen.verses WHERE reference = ${reference} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getVersesByChapter(db: Db, bookId: string, chapter: number) {
  return db.execute(
    sql`SELECT ${VERSE_COLUMNS} FROM lumen.verses
        WHERE book_id = ${bookId} AND chapter_number = ${chapter}
        ORDER BY verse_number`,
  );
}

export async function getChapterNumbers(db: Db, bookId: string) {
  return db.execute(
    sql`SELECT DISTINCT chapter_number FROM lumen.verses
        WHERE book_id = ${bookId}
        ORDER BY chapter_number`,
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
    sql`SELECT ${VERSE_COLUMNS} FROM lumen.verses
        WHERE book_id = ${bookId}
          AND (chapter_number * 1000 + verse_number) >= ${startChapter * 1000 + startVerse}
          AND (chapter_number * 1000 + verse_number) <= ${endChapter * 1000 + endVerse}
        ORDER BY chapter_number, verse_number
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
      sql`SELECT ${VERSE_COLUMNS}, ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
          FROM lumen.verses
          WHERE search_vector @@ plainto_tsquery('english', ${query})
            AND volume_id = ${volume}
          ORDER BY rank DESC
          LIMIT ${limit}`,
    );
  }
  return db.execute(
    sql`SELECT ${VERSE_COLUMNS}, ts_rank(search_vector, plainto_tsquery('english', ${query})) AS rank
        FROM lumen.verses
        WHERE search_vector @@ plainto_tsquery('english', ${query})
        ORDER BY rank DESC
        LIMIT ${limit}`,
  );
}

export async function getBooksByVolume(db: Db, volumeId: string) {
  const fromEntities = await db.execute(
    sql`SELECT DISTINCT e.id, e.name, e.description, e.metadata FROM lumen.entities e
        JOIN lumen.verses v ON v.book_id = e.id
        WHERE e.entity_type = 'book'
          AND v.volume_id = ${volumeId}
        ORDER BY e.id`,
  );
  if ((fromEntities as any[]).length > 0) return fromEntities;

  return db.execute(
    sql`SELECT DISTINCT v.book_id AS id,
           COALESCE(e.name, v.book_id) AS name,
           e.description,
           e.metadata
        FROM lumen.verses v
        LEFT JOIN lumen.entities e ON e.id = v.book_id
        WHERE v.volume_id = ${volumeId}
        ORDER BY v.book_id`,
  );
}

export async function getAllBooks(db: Db) {
  // Single-book volumes (D&C) can't have a book entity — entities share one id
  // namespace and the volume row already owns the id. A volume whose own id
  // appears as a verses.book_id IS its own book; that test stays correct even
  // if the volume later gains sibling book children (Official Declarations).
  return db.execute(
    sql`SELECT id, name,
           metadata->>'volume_id' AS volume_id,
           (metadata->>'sort_order')::int AS sort_order,
           (metadata->>'chapter_count')::int AS chapter_count
        FROM lumen.entities
        WHERE entity_type = 'book'
        UNION ALL
        SELECT v.id, v.name,
           v.id AS volume_id,
           0 AS sort_order,
           NULL::int AS chapter_count
        FROM lumen.entities v
        WHERE v.entity_type = 'volume'
          AND EXISTS (
            SELECT 1 FROM lumen.verses vs WHERE vs.book_id = v.id
          )
        ORDER BY sort_order`,
  );
}

export async function getVolumeList(db: Db) {
  return db.execute(
    sql`SELECT id, name, description, metadata FROM lumen.entities
        WHERE entity_type = 'volume'
        ORDER BY id`,
  );
}

export async function getEntity(db: Db, id: string) {
  const rows = await db.execute(
    sql`SELECT id, entity_type, name, description, metadata, source FROM lumen.entities
        WHERE id = ${id} LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getChapterArt(db: Db, bookId: string, chapter: number, limit = 24) {
  return db.execute(
    sql`SELECT id, name, metadata FROM lumen.entities
        WHERE entity_type = 'artwork'
          AND metadata->'refs' @> ${JSON.stringify([{ book_id: bookId, chapter }])}::jsonb
        ORDER BY (metadata->>'fame')::numeric DESC NULLS LAST, id
        LIMIT ${limit}`,
  );
}

export async function getPublicCollectionIds(db: Db) {
  const rows = await db.execute(
    sql`SELECT id FROM lumen.collections WHERE public = true ORDER BY id`,
  );
  return (rows as { id: string }[]).map((r) => r.id);
}

export async function getChapterSummary(db: Db, bookId: string, chapter: number) {
  const summaryId = `${bookId}-${chapter}-summary`;
  const rows = await db.execute(
    sql`SELECT id, name, description, metadata FROM lumen.entities
        WHERE id = ${summaryId} AND entity_type = 'chapter_summary'
        LIMIT 1`,
  );
  return rows[0] ?? null;
}
