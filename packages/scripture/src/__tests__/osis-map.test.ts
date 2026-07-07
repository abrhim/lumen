import { describe, it, expect } from 'vitest';
// Harness (tske-cross-references): OSIS↔slug mapping + ref parsing + range
// expansion. FM-1/FM-2 — these are the pure functions the ingest trusts.
import { OSIS_TO_SLUG, parseOsisRef, expandOsisRange } from '../osis-map';

// The 66 live book ids (probed from prod at plan time), OT+NT.
const LIVE_SLUGS = new Set([
	'matt','mark','luke','john','acts','rom','1-cor','2-cor','gal','eph','philip',
	'col','1-thes','2-thes','1-tim','2-tim','titus','philem','heb','james','1-pet',
	'2-pet','1-jn','2-jn','3-jn','jude','rev',
	'gen','ex','lev','num','deut','josh','judg','ruth','1-sam','2-sam','1-kgs',
	'2-kgs','1-chr','2-chr','ezra','neh','esth','job','ps','prov','eccl','song',
	'isa','jer','lam','ezek','dan','hosea','joel','amos','obad','jonah','micah',
	'nahum','hab','zeph','hag','zech','mal',
]);

describe('OSIS mapping (FM-1)', () => {
	it('maps all 66 OSIS codes to live book slugs, exhaustively', () => {
		expect(Object.keys(OSIS_TO_SLUG)).toHaveLength(66);
		for (const [code, slug] of Object.entries(OSIS_TO_SLUG)) {
			expect(LIVE_SLUGS.has(slug), `${code} → ${slug} not a live book id`).toBe(true);
		}
		// every live Bible slug is reachable (bijection, not just injection)
		expect(new Set(Object.values(OSIS_TO_SLUG)).size).toBe(66);
	});

	it('maps the known trap codes', () => {
		expect(OSIS_TO_SLUG['Phil']).toBe('philip'); // NOT philem
		expect(OSIS_TO_SLUG['Phlm']).toBe('philem');
		expect(OSIS_TO_SLUG['Hos']).toBe('hosea');
		expect(OSIS_TO_SLUG['Exod']).toBe('ex');
		expect(OSIS_TO_SLUG['1John']).toBe('1-jn');
		expect(OSIS_TO_SLUG['Song']).toBe('song');
		expect(OSIS_TO_SLUG['Judg']).toBe('judg');
		expect(OSIS_TO_SLUG['Jude']).toBe('jude');
	});
});

describe('parseOsisRef (FM-1)', () => {
	it('parses plain refs to our verse ids', () => {
		expect(parseOsisRef('Gen.1.1')).toBe('gen-1-1');
		expect(parseOsisRef('1Cor.13.4')).toBe('1-cor-13-4');
		expect(parseOsisRef('Ps.119.105')).toBe('ps-119-105');
	});

	it('returns null for unknown codes and malformed refs, never throws', () => {
		expect(parseOsisRef('Tob.1.1')).toBeNull();
		expect(parseOsisRef('Gen.1')).toBeNull();
		expect(parseOsisRef('')).toBeNull();
	});
});

describe('expandOsisRange (FM-2)', () => {
	// injected lookup: chapter id → verse count (live values not needed for units)
	const counts = new Map([
		['ps-148', 14],
		['prov-8', 36],
		['prov-9', 18],
	]);
	const lookup = (chapterId: string) => counts.get(chapterId) ?? null;

	it('expands a same-chapter range inclusively', () => {
		expect(expandOsisRange('Ps.148.4', 'Ps.148.5', lookup)).toEqual(['ps-148-4', 'ps-148-5']);
	});

	it('expands a cross-chapter range through the chapter boundary', () => {
		const ids = expandOsisRange('Prov.8.35', 'Prov.9.2', lookup);
		expect(ids).toEqual(['prov-8-35', 'prov-8-36', 'prov-9-1', 'prov-9-2']);
	});

	it('property: endpoints match and length equals the span', () => {
		const ids = expandOsisRange('Ps.148.4', 'Ps.148.9', lookup)!;
		expect(ids[0]).toBe('ps-148-4');
		expect(ids[ids.length - 1]).toBe('ps-148-9');
		expect(ids).toHaveLength(6);
	});

	it('returns null on unknown chapters or inverted ranges, never throws', () => {
		expect(expandOsisRange('Tob.1.1', 'Tob.1.3', lookup)).toBeNull();
		expect(expandOsisRange('Ps.148.9', 'Ps.148.4', lookup)).toBeNull();
	});
});
