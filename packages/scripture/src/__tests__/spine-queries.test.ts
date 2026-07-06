import { describe, it, expect, vi } from 'vitest';
// Harness (canon-spine): structural queries must read the spine, not entities.
// Signatures stay stable (MCP compatibility) — only internals move.
import {
	getAllBooks,
	getBooksByVolume,
	getChapterNumbers,
	getVolumeList,
	getChapterSummary,
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
