import { describe, it, expect, vi } from 'vitest';
// Harness (canon-spine): structural queries must read the spine, not entities.
// Signatures stay stable (MCP compatibility) — only internals move.
// Extended per synthesis (harness-revision): COR-2, API-1, API-4, API-5.
import {
	getAllBooks,
	getBooksByVolume,
	getChapterNumbers,
	getVolumeList,
	getChapterSummary,
	getVersesByChapter,
	getVerseById,
	getPassage,
	searchScriptures,
} from '../queries';
import { resolveReference } from '../resolve-reference';

/** Captures the SQL objects handed to db.execute; strings are embedded in the chunks. */
function capturingDb(rows: unknown[] = []) {
	const captured: string[] = [];
	const db = {
		execute: vi.fn(async (q: unknown) => {
			captured.push(JSON.stringify(q));
			return rows;
		}),
	} as any;
	return { db, captured };
}

describe('spine queries (canon-spine harness)', () => {
	it('getVolumeList reads lumen.volumes (FM-6)', async () => {
		const { db, captured } = capturingDb([]);
		await getVolumeList(db);
		expect(captured.join()).toContain('lumen.volumes');
	});

	it('getAllBooks reads lumen.books — no UNION heuristic, no entities (FM-5/FM-6)', async () => {
		const { db, captured } = capturingDb([]);
		await getAllBooks(db);
		const q = captured.join();
		expect(q).toContain('lumen.books');
		expect(q).not.toContain('UNION');
		expect(q).not.toContain('lumen.entities');
	});

	it('getBooksByVolume reads lumen.books without the verses-derived fallback', async () => {
		const { db, captured } = capturingDb([]);
		await getBooksByVolume(db, 'dc');
		const q = captured.join();
		expect(q).toContain('lumen.books');
		expect(q).not.toContain('lumen.verses');
	});

	it('getChapterNumbers reads lumen.chapters (FM-6)', async () => {
		const { db, captured } = capturingDb([]);
		await getChapterNumbers(db, '1-ne');
		expect(captured.join()).toContain('lumen.chapters');
	});

	it('getChapterSummary looks up by metadata.chapter_id, not id-string convention', async () => {
		const { db, captured } = capturingDb([]);
		await getChapterSummary(db, '1-ne', 3);
		const q = captured.join();
		expect(q).toContain('chapter_id');
		expect(q).not.toContain('-summary');
	});

	it('getVersesByChapter (hottest path) filters by chapter_id, not transition columns (API-2)', async () => {
		const { db, captured } = capturingDb([]);
		await getVersesByChapter(db, '1-ne', 3);
		const q = captured.join();
		expect(q).toContain('chapter_id');
		expect(q).not.toContain('chapter_number =');
	});

	it('getVerseById keeps MCP field names via spine-safe aliases (API-1/API-4)', async () => {
		const { db, captured } = capturingDb([]);
		await getVerseById(db, '1-ne-3-7');
		const q = captured.join();
		// old JSON shape survives P4: these exact field names must still be selected
		expect(q).toContain('book_id');
		expect(q).toContain('chapter_number');
		expect(q).toContain('volume_id');
	});

	it('getPassage orders through chapters.number, not chapter arithmetic (COR-1/PERF-7)', async () => {
		const { db, captured } = capturingDb([]);
		await getPassage(db, '1-ne', 3, 1, 4, 10, 50);
		const q = captured.join();
		expect(q).toContain('lumen.chapters');
		expect(q).not.toContain('* 1000');
	});

	it('searchScriptures volume filter joins through the spine (COR-3)', async () => {
		const { db, captured } = capturingDb([]);
		await searchScriptures(db, 'faith', 'bom', 5);
		const q = captured.join();
		expect(q).toContain('lumen.chapters');
		expect(q).toContain('lumen.books');
		expect(q).not.toContain('volume_id =');
	});

	it('resolveReference chapter + verse levels keep their MCP JSON shapes (COR-2/API-1)', async () => {
		const verseRow = {
			id: '1-ne-3-7', volume_id: 'bom', book_id: '1-ne', chapter_number: 3,
			verse_number: 7, text: 'And it came to pass…', reference: '1 Nephi 3:7',
		};
		const { db } = capturingDb([verseRow]);
		const chapterRes = await resolveReference(db, '1-ne-3');
		expect(chapterRes.level).toBe('chapter');
		if (chapterRes.level === 'chapter' && 'verses' in chapterRes) {
			expect(chapterRes.verse_count).toBe(1);
		}
		const { db: db2 } = capturingDb([verseRow]);
		const verseRes = await resolveReference(db2, '1-ne-3-7');
		expect(verseRes.level).toBe('verse');
		expect(verseRes).toMatchObject({
			book_id: '1-ne', chapter_number: 3, verse_number: 7, volume_id: 'bom',
		});
	});

	it('resolveReference keeps its MCP-facing shapes for volume/book inputs (FM-7)', async () => {
		const { db } = capturingDb([{ id: '1-ne', name: '1 Nephi' }]);
		const vol = await resolveReference(db, 'bom');
		expect(vol.level).toBe('volume');
		if (vol.level === 'volume' && 'books' in vol) {
			expect(vol.books[0]).toEqual({ id: '1-ne', name: '1 Nephi' });
		}
		const { db: db2 } = capturingDb([{ chapter_number: 1 }, { chapter_number: 2 }]);
		const book = await resolveReference(db2, '1-ne');
		expect(book.level).toBe('book');
		if (book.level === 'book' && 'chapters' in book) {
			expect(book.chapters).toEqual([1, 2]);
		}
	});
});
