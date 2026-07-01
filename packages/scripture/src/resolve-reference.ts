import type { Db } from './types';
import {
  getVerseById,
  getVerseByReference,
  getVersesByChapter,
  getChapterNumbers,
  getBooksByVolume,
  getVolumeList,
  getChapterSummary,
} from './queries';
import { parseReference, VOLUME_ID_LIST } from './slug-map';

export type ResolvedReference =
  | { level: 'volume'; volume_id: string; books: Array<{ id: string; name: string }> }
  | { level: 'volume'; found: false; message: string; available_volumes: Array<{ id: string; name: string }> }
  | { level: 'book'; book_id: string; chapters: number[] }
  | { level: 'book'; found: false; message: string }
  | { level: 'chapter'; book_id: string; chapter: number; verse_count: number; summary: string | null; verses: any[] }
  | { level: 'verse'; found?: boolean; [key: string]: any }
  | { level: 'unknown'; found: false; message: string };

export async function resolveReference(db: Db, reference: string): Promise<ResolvedReference> {
  const parsed = parseReference(reference);

  switch (parsed.level) {
    case 'volume': {
      const books = await getBooksByVolume(db, parsed.volumeId!);
      if ((books as any[]).length === 0) {
        const volumes = await getVolumeList(db);
        return {
          level: 'volume',
          found: false,
          message: `No books found for volume "${parsed.volumeId}".`,
          available_volumes: (volumes as any[]).map((v: any) => ({ id: v.id, name: v.name })),
        };
      }
      return {
        level: 'volume',
        volume_id: parsed.volumeId!,
        books: (books as any[]).map((b: any) => ({ id: b.id, name: b.name })),
      };
    }

    case 'book': {
      const chapters = await getChapterNumbers(db, parsed.bookId!);
      if ((chapters as any[]).length === 0) {
        return { level: 'book', found: false, message: `No chapters found for book "${parsed.bookId}".` };
      }
      return {
        level: 'book',
        book_id: parsed.bookId!,
        chapters: (chapters as any[]).map((c: any) => c.chapter_number),
      };
    }

    case 'chapter': {
      const [verses, summary] = await Promise.all([
        getVersesByChapter(db, parsed.bookId!, parsed.chapter!),
        getChapterSummary(db, parsed.bookId!, parsed.chapter!),
      ]);
      return {
        level: 'chapter',
        book_id: parsed.bookId!,
        chapter: parsed.chapter!,
        verse_count: (verses as any[]).length,
        summary: summary ? (summary as any).description : null,
        verses: verses as any[],
      };
    }

    case 'verse': {
      const id = `${parsed.bookId}-${parsed.chapter}-${parsed.verse}`;
      const verse = await getVerseById(db, id);
      if (!verse) {
        return { level: 'verse', found: false, message: `Verse "${id}" not found.` };
      }
      return { level: 'verse', ...verse };
    }

    case 'unknown': {
      const byId = await getVerseById(db, parsed.raw);
      if (byId) return { level: 'verse', ...byId };

      const byRef = await getVerseByReference(db, parsed.raw);
      if (byRef) return { level: 'verse', ...byRef };

      return {
        level: 'unknown',
        found: false,
        message: `Could not resolve "${parsed.raw}". Try a volume (${VOLUME_ID_LIST.join(', ')}), book ID, or verse reference.`,
      };
    }

    default:
      return { level: 'unknown', found: false, message: `Could not resolve "${parsed.raw}".` };
  }
}
