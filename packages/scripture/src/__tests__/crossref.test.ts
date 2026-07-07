import { describe, it, expect, vi } from 'vitest';
// Harness (tske-cross-references): query shape + panel grouping helpers.
// FM-4/FM-5/FM-6 — vote ordering, range dedup, both directions.
import { getCrossReferences, groupCrossRefs, type CrossRefRow } from '../crossrefs';

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

describe('getCrossReferences SQL shape', () => {
	it('reads lumen.edges for BOTH directions, filtered by collection, vote-ordered (FM-6)', async () => {
		const { db, captured } = capturingDb([]);
		await getCrossReferences(db, 'john-3-16', { collectionId: 'openbible' });
		const q = captured.join();
		expect(q).toContain('lumen.edges');
		expect(q).toContain('from_id');
		expect(q).toContain('to_id');
		expect(q).toContain('votes');
		expect(q).not.toContain('lumen.entities');
	});

	it('joins target verses for reference + text (panel needs snippets)', async () => {
		const { db, captured } = capturingDb([]);
		await getCrossReferences(db, 'john-3-16', { collectionId: 'openbible' });
		expect(captured.join()).toContain('lumen.verses');
	});
});

describe('groupCrossRefs (FM-5: one card per range, vote-sorted)', () => {
	const row = (o: Partial<Omit<CrossRefRow, 'total'>>): Omit<CrossRefRow, 'total'> => ({
		verse_id: 'ps-148-4', reference: 'Psalm 148:4', text: 'Praise him…',
		direction: 'outgoing', votes: 10, range_start: null, range_end: null, ...o,
	});

	it('collapses expanded range rows into one card keyed by range_start', () => {
		const cards = groupCrossRefs([
			row({ verse_id: 'ps-148-4', range_start: 'ps-148-4', range_end: 'ps-148-5', votes: 59 }),
			row({ verse_id: 'ps-148-5', range_start: 'ps-148-4', range_end: 'ps-148-5', votes: 59 }),
			row({ verse_id: 'heb-11-3', reference: 'Hebrews 11:3', votes: 271 }),
		]);
		expect(cards).toHaveLength(2);
		const range = cards.find((c) => c.range_end);
		expect(range?.verse_id).toBe('ps-148-4');
	});

	it('sorts by votes descending; negative votes rank last (FM-6, Q4 default)', () => {
		const cards = groupCrossRefs([
			row({ verse_id: 'a-1-1', votes: -3 }),
			row({ verse_id: 'b-1-1', votes: 271 }),
			row({ verse_id: 'c-1-1', votes: 12 }),
		]);
		expect(cards.map((c) => c.votes)).toEqual([271, 12, -3]);
	});

	it('keeps directions separate — a verse citing and cited by the same target stays two cards', () => {
		const cards = groupCrossRefs([
			row({ verse_id: 'x-1-1', direction: 'outgoing' }),
			row({ verse_id: 'x-1-1', direction: 'incoming' }),
		]);
		expect(cards).toHaveLength(2);
	});
});
