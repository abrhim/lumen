import { describe, it, expect } from 'vitest';
import { resolveAnchorRef, anchorRefToPath } from '../notes-refs';

/** Note-to-note links (Abram, 2026-07-31): `note:<uuid>` — additive to the
 * A8 grammar; the pinned harness fixtures are untouched. */
describe('note link refs', () => {
	const uuid = '6a296036-5fe5-46e5-944d-93ef616f2b94';

	it('resolves note:<uuid> as kind note', () => {
		expect(resolveAnchorRef(`note:${uuid}`)).toEqual({ kind: 'note', ref: `note:${uuid}` });
	});

	it('paths to /notes/<uuid>', () => {
		expect(anchorRefToPath({ kind: 'note', ref: `note:${uuid}` })).toBe(`/notes/${uuid}`);
	});

	it('fails closed on every malformed colon shape', () => {
		expect(resolveAnchorRef('note:')).toBeNull();
		expect(resolveAnchorRef('note:not-a-uuid')).toBeNull();
		expect(resolveAnchorRef(`note:${uuid.toUpperCase()}`)).toBeNull();
		expect(resolveAnchorRef(`note:${uuid}/extra`)).toBeNull();
		expect(resolveAnchorRef(`notes:${uuid}`)).toBeNull();
		expect(resolveAnchorRef(`x:${uuid}`)).toBeNull();
		expect(resolveAnchorRef('alma:32')).toBeNull();
		expect(resolveAnchorRef(`note:../${uuid}`)).toBeNull();
	});

	it('leaves the colon-free grammar untouched', () => {
		expect(resolveAnchorRef('alma-32-21')?.kind).toBe('verse');
		expect(resolveAnchorRef('alma-32')?.kind).toBe('chapter');
		expect(resolveAnchorRef('nephi-1')?.kind).toBe('entity');
	});
});
