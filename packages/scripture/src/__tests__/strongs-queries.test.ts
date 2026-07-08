import { describe, it, expect, vi } from 'vitest';
// Harness (strongs): query shapes for the word-study layer.
import { getWordTags, getVersesByStrongs } from '../strongs';

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

describe('getWordTags SQL shape (FM-6/FM-10)', () => {
	it('one round trip: word_tags joined to words + LEFT JOIN lexicon (missing entries degrade, not drop)', async () => {
		const { db, captured } = capturingDb([]);
		await getWordTags(db, 'john-3-16');
		const q = captured.join();
		expect(db.execute).toHaveBeenCalledTimes(1);
		expect(q).toContain('lumen.word_tags');
		expect(q).toContain('lumen.words');
		expect(q).toContain('LEFT JOIN');
		expect(q).toContain('strongs_lexicon');
		expect(q).toContain('char_start');
	});

	it('aggregates to ONE row per word with ordered entries (PO-3/CD-7 pinned — CS-7)', async () => {
		const { db, captured } = capturingDb([]);
		await getWordTags(db, 'john-3-16');
		const q = captured.join();
		expect(q).toContain('GROUP BY');
		expect(q).toContain('json_agg');
		expect(q).toContain('ORDINALITY');
		expect(q).toContain('original'); // word page + inline card show the script
	});
});

describe('getVersesByStrongs SQL shape (FM-9)', () => {
	it('GIN containment on the strongs array, joined to verses, bounded', async () => {
		const { db, captured } = capturingDb([]);
		await getVersesByStrongs(db, 'H7225', 5);
		const q = captured.join();
		expect(q).toContain('lumen.word_tags');
		expect(q).toContain('@>');
		expect(q).toContain('lumen.verses');
		expect(q).toContain('5');
	});
});
