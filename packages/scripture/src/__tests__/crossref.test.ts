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
		expect(q).toContain('collection_id'); // the hybrid routing mechanism (CAPI-7)
		expect(q).not.toContain('lumen.entities');
	});

	it('joins target verses for reference + text (panel needs snippets)', async () => {
		const { db, captured } = capturingDb([]);
		await getCrossReferences(db, 'john-3-16', { collectionId: 'openbible' });
		expect(captured.join()).toContain('lumen.verses');
	});

	it('is ONE round trip via UNION ALL, as amendment 14 pins (CAPI-5)', async () => {
		const { db, captured } = capturingDb([]);
		await getCrossReferences(db, 'john-3-16', { collectionId: 'openbible' });
		expect(db.execute).toHaveBeenCalledTimes(1);
		expect(captured.join()).toContain('UNION ALL');
	});

	it('defaults to 20 per direction; caller can override (CAPI-6)', async () => {
		const { db, captured } = capturingDb([]);
		await getCrossReferences(db, 'john-3-16', { collectionId: 'openbible' });
		expect(captured.join()).toContain('20');
		const { db: db2, captured: captured2 } = capturingDb([]);
		await getCrossReferences(db2, 'john-3-16', { collectionId: 'openbible', limitPerDirection: 5 });
		expect(captured2.join()).toContain('5');
	});

	it('extracts per-direction totals and strips transport `total` from rows (CAPI-3/CAPI-4)', async () => {
		const sqlRow = (o: Record<string, unknown>) => ({
			verse_id: 'heb-11-3', reference: 'Hebrews 11:3', text: 'Through faith…',
			direction: 'outgoing', votes: 271, range_start: null, range_end: null,
			source: 'openbible', total: 143, ...o,
		});
		const { db } = capturingDb([
			sqlRow({}),
			sqlRow({ verse_id: 'rom-1-20', reference: 'Romans 1:20', votes: 40 }),
			sqlRow({ direction: 'incoming', verse_id: 'ps-104-24', reference: 'Psalm 104:24', total: 7 }),
		]);
		const { refs, totals } = await getCrossReferences(db, 'gen-1-1', { collectionId: 'openbible' });
		expect(totals).toEqual({ outgoing: 143, incoming: 7 });
		expect(refs).toHaveLength(3);
		for (const r of refs) expect('total' in r).toBe(false);
	});
});

describe('groupCrossRefs (FM-5: direction-aware cards, vote-sorted)', () => {
	const row = (o: Partial<CrossRefRow>): CrossRefRow => ({
		verse_id: 'ps-148-4', reference: 'Psalm 148:4', text: 'Praise him…',
		direction: 'outgoing', votes: 10, range_start: null, range_end: null,
		source: 'openbible', ...o,
	});

	it('labels an outgoing range card from its representative row ("Psalm 148:4–5")', () => {
		// the SQL representative filter returns ONE row per outgoing range
		const cards = groupCrossRefs([
			row({ verse_id: 'ps-148-4', range_start: 'ps-148-4', range_end: 'ps-148-5', votes: 59 }),
			row({ verse_id: 'heb-11-3', reference: 'Hebrews 11:3', votes: 271 }),
		]);
		expect(cards).toHaveLength(2);
		const range = cards.find((c) => c.range_end);
		expect(range?.verse_id).toBe('ps-148-4');
		expect(range?.label).toBe('Psalm 148:4–5');
	});

	it('INCOMING rows ignore range metadata: keyed/labeled by the CITING verse, never collapsed (CCOR-1/CAPI-2)', () => {
		// two distinct verses each cite a range containing the verse being read —
		// the range describes the TARGET side and must not merge or relabel them
		const cards = groupCrossRefs([
			row({ direction: 'incoming', verse_id: 'rom-8-28', reference: 'Romans 8:28', range_start: 'ps-148-1', range_end: 'ps-148-6' }),
			row({ direction: 'incoming', verse_id: 'james-1-2', reference: 'James 1:2', range_start: 'ps-148-1', range_end: 'ps-148-6' }),
		]);
		expect(cards).toHaveLength(2);
		expect(cards.map((c) => c.verse_id).sort()).toEqual(['james-1-2', 'rom-8-28']);
		for (const c of cards) {
			expect(c.label).toBe(c.verse_id === 'rom-8-28' ? 'Romans 8:28' : 'James 1:2');
			expect(c.range_end).toBeNull();
		}
	});

	it('sorts by votes descending; negative and null votes rank last (FM-6, Q4)', () => {
		const cards = groupCrossRefs([
			row({ verse_id: 'a-1-1', votes: -3 }),
			row({ verse_id: 'b-1-1', votes: 271 }),
			row({ verse_id: 'd-1-1', votes: null, source: 'anthropic-batch' }),
			row({ verse_id: 'c-1-1', votes: 12 }),
		]);
		expect(cards.map((c) => c.votes)).toEqual([271, 12, -3, null]);
	});

	it('keeps directions separate and carries source through (provenance labels)', () => {
		const cards = groupCrossRefs([
			row({ verse_id: 'x-1-1', direction: 'outgoing' }),
			row({ verse_id: 'x-1-1', direction: 'incoming', source: 'anthropic-batch' }),
		]);
		expect(cards).toHaveLength(2);
		expect(cards.find((c) => c.direction === 'incoming')?.source).toBe('anthropic-batch');
	});
});
