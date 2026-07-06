import { describe, it, expect } from 'vitest';
// Harness (canon-spine): written before implementation — docs/features/canon-spine/plan.md
import { tokenize } from '../tokenize';

const KJV_SAMPLE =
	'And he said unto me: "Behold, the LORD’s hand is stretched out still—go to Beth-el."';

describe('tokenize — the words contract (canon-spine harness)', () => {
	it('offsets round-trip: slice(start,end) === surface for every token (FM-1)', () => {
		const text = 'And it came to pass that I, Nephi, said unto my father';
		for (const t of tokenize(text)) {
			expect(text.slice(t.char_start, t.char_end)).toBe(t.surface);
		}
	});

	it('positions are contiguous from 1; no empty tokens (FM-2)', () => {
		const tokens = tokenize(KJV_SAMPLE);
		expect(tokens.length).toBeGreaterThan(0);
		tokens.forEach((t, i) => {
			expect(t.position).toBe(i + 1);
			expect(t.surface.length).toBeGreaterThan(0);
		});
	});

	it('keeps word-internal apostrophes and hyphens; never tokenizes punctuation (FM-2)', () => {
		const surfaces = tokenize(KJV_SAMPLE).map((t) => t.surface);
		expect(surfaces).toContain('LORD’s');
		expect(surfaces).toContain('Beth-el');
		for (const s of surfaces) expect(s).toMatch(/^[A-Za-z0-9]/);
		expect(surfaces.join(' ')).not.toMatch(/[:"—,.]/);
	});

	it('normalizes case and curly apostrophes; surface stays verbatim', () => {
		const lords = tokenize(KJV_SAMPLE).find((t) => t.surface === 'LORD’s');
		expect(lords?.normalized).toBe("lord's");
	});

	it('is deterministic and handles numerals and em-dash boundaries', () => {
		const text = 'in the 600th year—even then';
		const a = tokenize(text);
		const b = tokenize(text);
		expect(a).toEqual(b);
		expect(a.map((t) => t.normalized)).toEqual(['in', 'the', '600th', 'year', 'even', 'then']);
	});

	it('property: round-trip + monotonic non-overlapping offsets over varied texts', () => {
		const texts = [
			'',
			'   ',
			'Amen.',
			'A—B',
			"children's children",
			'And God said, Let there be light: and there was light.',
			'Wo, wo, wo, unto the inhabitants of the earth!',
		];
		for (const text of texts) {
			let prevEnd = -1;
			for (const t of tokenize(text)) {
				expect(text.slice(t.char_start, t.char_end)).toBe(t.surface);
				expect(t.char_start).toBeGreaterThan(prevEnd - 1);
				expect(t.char_end).toBeGreaterThan(t.char_start);
				prevEnd = t.char_end;
			}
		}
	});
});
