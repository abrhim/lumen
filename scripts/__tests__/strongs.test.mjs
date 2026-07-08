// Harness (strongs): ingest pure functions — number normalization, OSIS span
// parsing, deterministic alignment. Fixtures are REAL probed KJV2006 markup.
// Run: node --import tsx --test scripts/__tests__/strongs.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as tokenizer from '../../packages/scripture/src/tokenize.ts';
import {
  normalizeStrongs,
  parseVerseSpans,
  alignSpansToWords,
  skipCapVerdict,
  _setTokenizer,
} from '../ingest-strongs.mjs';

_setTokenizer(tokenizer);

test('normalizeStrongs: zero-pad stripped, case fixed, extended suffix kept (FM-1)', () => {
  assert.equal(normalizeStrongs('strong:H07225'), 'H7225');
  assert.equal(normalizeStrongs('H0430'), 'H430');
  assert.equal(normalizeStrongs('strong:G025'), 'G25');
  assert.equal(normalizeStrongs('H1254A'), 'H1254A');
  assert.equal(normalizeStrongs('h1254a'), 'H1254A');
  assert.equal(normalizeStrongs('strong:G3588'), 'G3588');
  assert.equal(normalizeStrongs('garbage'), null);
});

const GEN_1_1 = `<verse osisID="Gen.1.1" sID="Gen.1.1"/><w lemma="strong:H07225">In the beginning</w> <w lemma="strong:H0430">God</w> <w morph="strongMorph:TH8804" lemma="strong:H0853 strong:H01254">created</w> <w lemma="strong:H08064">the heaven</w> <w lemma="strong:H0853">and</w> <w lemma="strong:H0776">the earth</w>.<verse eID="Gen.1.1"/>`;

const JOHN_3_16 = `<verse osisID="John.3.16" sID="John.3.16"/><milestone type="x-p" marker="¶"/><w src="17" lemma="strong:G3588" morph="robinson:T-NSM"/><w src="2" lemma="strong:G1063" morph="robinson:CONJ">For</w> <w src="4 5" lemma="strong:G3588 strong:G2316" morph="robinson:T-NSM robinson:N-NSM">God</w> <w src="1" lemma="strong:G3779" morph="robinson:ADV">so</w> <w src="3" lemma="strong:G25" morph="robinson:V-AAI-3S">loved</w> <transChange type="added">that</transChange><verse eID="John.3.16"/>`;

test('parseVerseSpans: extracts tagged spans, skips empty <w/> and transChange (FM-2/FM-4)', () => {
  const spans = parseVerseSpans(GEN_1_1);
  assert.equal(spans.length, 6);
  assert.deepEqual(spans[0], { text: 'In the beginning', strongs: ['H7225'], morph: null });
  assert.deepEqual(spans[2], { text: 'created', strongs: ['H853', 'H1254'], morph: 'strongMorph:TH8804' });

  const nt = parseVerseSpans(JOHN_3_16);
  assert.equal(nt.length, 4); // empty <w/> and transChange excluded
  assert.deepEqual(nt[1], { text: 'God', strongs: ['G3588', 'G2316'], morph: 'robinson:T-NSM robinson:N-NSM' });
});

const gen11Words = [
  'In', 'the', 'beginning', 'God', 'created', 'the', 'heaven', 'and', 'the', 'earth',
].map((surface, i) => ({
  id: `gen-1-1-w${i + 1}`, position: i + 1, surface, normalized: surface.toLowerCase(),
}));

test('nested divineName/seg markup inside <w> is STRIPPED to text, never read as empty (CD-2 — 18.7% of verses)', () => {
  const PS_STYLE = `<verse osisID="Ps.23.1" sID="Ps.23.1"/><w lemma="strong:H03068"><seg><divineName>Lord</divineName></seg></w> <w lemma="strong:H07462">is my shepherd</w><verse eID="Ps.23.1"/>`;
  const spans = parseVerseSpans(PS_STYLE);
  assert.equal(spans.length, 2);
  assert.deepEqual(spans[0], { text: 'Lord', strongs: ['H3068'], morph: null });
});

test('tagged <w> nested inside transChange is extracted; note content is excluded (CD-1)', () => {
  const MIXED = `<verse osisID="X.1.1" sID="X.1.1"/><transChange type="added">it <w lemma="strong:G1096">to be</w></transChange> <note>study <w lemma="strong:G9999">noise</w></note><w lemma="strong:G3779">so</w><verse eID="X.1.1"/>`;
  const spans = parseVerseSpans(MIXED);
  assert.deepEqual(spans.map((s) => s.text), ['to be', 'so']);
  assert.ok(!spans.some((s) => s.strongs.includes('G9999')));
});

test('EN DASH compound names normalize to ASCII hyphen (live 1Chr.1.49 class — 1,187 verses)', () => {
  const CHR = `<verse osisID="1Chr.1.49" sID="x"/><w lemma="strong:H01177">Baal–hanan</w><verse eID="x"/>`;
  const spans = parseVerseSpans(CHR);
  assert.equal(spans[0].text, 'Baal-hanan');
  const words = [{ id: 'w1', position: 1, surface: 'Baal-hanan', normalized: 'baal-hanan' }];
  const { ok, tags } = alignSpansToWords(spans, words);
  assert.equal(ok, true);
  assert.deepEqual(tags[0].strongs, ['H1177']);
});

test('alignSpansToWords: phrase spans tag every member word; sequential and deterministic (FM-2/Q3)', () => {
  const spans = parseVerseSpans(GEN_1_1);
  const result = alignSpansToWords(spans, gen11Words);
  assert.equal(result.ok, true);
  const byPos = new Map(result.tags.map((t) => [t.position, t]));
  // "In the beginning" → words 1..3 all H7225
  for (const p of [1, 2, 3]) assert.deepEqual(byPos.get(p).strongs, ['H7225']);
  assert.deepEqual(byPos.get(5).strongs, ['H853', 'H1254']); // created
  assert.equal(byPos.get(5).morph, 'strongMorph:TH8804');
  assert.equal(result.tags.length, 10); // every word tagged in this verse
});

test('alignSpansToWords: any drift skips the WHOLE verse — never partial-guesses (FM-3)', () => {
  const spans = parseVerseSpans(GEN_1_1);
  const mutated = gen11Words.map((w) => (w.position === 4 ? { ...w, normalized: 'gods' } : w));
  const result = alignSpansToWords(spans, mutated);
  assert.equal(result.ok, false);
  assert.equal(result.tags.length, 0);
});

test('alignSpansToWords: untagged trailing words are fine (transChange gaps)', () => {
  const spans = parseVerseSpans(JOHN_3_16);
  const words = ['For', 'God', 'so', 'loved', 'that'].map((s, i) => ({
    id: `john-3-16-w${i + 1}`, position: i + 1, surface: s, normalized: s.toLowerCase(),
  }));
  const result = alignSpansToWords(spans, words);
  assert.equal(result.ok, true);
  assert.equal(result.tags.length, 4); // 'that' (transChange) untagged
});

test('skipCapVerdict: 1% boundary exclusive (FM-5)', () => {
  assert.equal(skipCapVerdict(310, 31000, 0.01).pass, false);
  assert.equal(skipCapVerdict(309, 31000, 0.01).pass, true);
  assert.equal(skipCapVerdict(0, 0, 0.01).pass, true);
});
