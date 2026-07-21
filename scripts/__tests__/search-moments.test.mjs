// Harness (search-endpoint M3): windowCaptions pure-function bounds + chain.
// Run: node --test scripts/__tests__/search-moments.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windowCaptions } from '../build-search-moments.mjs';

const HARD_MAX = 800;
const MIN_TAIL = 200;

// H15 mirror: windows must chain exactly over the source seqs.
function assertChain(windows, captions) {
	assert.ok(windows.length > 0);
	assert.equal(windows[0].seq_start, captions[0].seq);
	assert.equal(windows[windows.length - 1].seq_end, captions[captions.length - 1].seq);
	for (let i = 1; i < windows.length; i++) {
		assert.equal(windows[i].seq_start, windows[i - 1].seq_end + 1);
	}
}

// Contiguous captions, no gaps: len chars each, no sentence ends.
function flatCaptions(n, len, opts = {}) {
	return Array.from({ length: n }, (_, i) => ({
		seq: i,
		t_start_s: i * 4,
		t_end_s: opts.nullEnds ? null : i * 4 + 4,
		text: 'x'.repeat(len),
	}));
}

test('DATC-4: multi-caption windows never exceed HARD_MAX (flush before append)', () => {
	const captions = flatCaptions(20, 100);
	const windows = windowCaptions(captions);
	assertChain(windows, captions);
	for (const w of windows) {
		assert.ok(
			w.text.length <= HARD_MAX,
			`window ${w.seq_start}-${w.seq_end} is ${w.text.length} chars > ${HARD_MAX}`,
		);
	}
});

test('DATC-4: single oversize caption is its own window — the only legal >HARD_MAX case', () => {
	const captions = [
		{ seq: 0, t_start_s: 0, t_end_s: 30, text: 'y'.repeat(900) },
		{ seq: 1, t_start_s: 30, t_end_s: 34, text: 'z'.repeat(300) + '.' },
	];
	const windows = windowCaptions(captions);
	assertChain(windows, captions);
	assert.equal(windows[0].seq_start, windows[0].seq_end); // single caption
	assert.equal(windows[0].text.length, 900);
	for (const w of windows) {
		if (w.seq_start !== w.seq_end) assert.ok(w.text.length <= HARD_MAX);
	}
});

test('DATC-4: tail-merge still fires when the merge fits under HARD_MAX', () => {
	const captions = [
		{ seq: 0, t_start_s: 0, t_end_s: 10, text: 'a'.repeat(300) + '.' },
		{ seq: 1, t_start_s: 10, t_end_s: 20, text: 'b'.repeat(249) + '.' }, // flush at 550
		{ seq: 2, t_start_s: 20, t_end_s: 24, text: 'c'.repeat(150) }, // short tail
	];
	const windows = windowCaptions(captions);
	assertChain(windows, captions);
	assert.equal(windows.length, 1); // 550 + 1 + 150 = 701 <= 800: merged
	assert.equal(windows[0].seq_end, 2);
	assert.ok(windows[0].text.length <= HARD_MAX);
});

test('DATC-4: tail-merge is skipped when it would breach HARD_MAX (short final window accepted)', () => {
	const captions = [
		{ seq: 0, t_start_s: 0, t_end_s: 25, text: 'a'.repeat(700) + '.' }, // flush at 701
		{ seq: 1, t_start_s: 25, t_end_s: 29, text: 'b'.repeat(150) }, // tail < MIN_TAIL
	];
	const windows = windowCaptions(captions);
	assertChain(windows, captions);
	assert.equal(windows.length, 2); // 701 + 1 + 150 = 852 > 800: no merge
	assert.ok(windows[0].text.length <= HARD_MAX);
	assert.equal(windows[1].text.length, 150);
	assert.ok(windows[1].text.length < MIN_TAIL); // documented trade-off: min bound yields to hard cap
});

test('windowCaptions: empty captions → empty windows', () => {
	assert.deepEqual(windowCaptions([]), []);
});

test('windowCaptions: null t_end_s on an appended caption falls back to last known end', () => {
	// 3×200 chars accumulate into ONE window; the final caption's null end
	// must not clobber the window's last known t_end_s (seq 1's end = 8).
	const captions = flatCaptions(3, 200).map((c, i) => (i === 2 ? { ...c, t_end_s: null } : c));
	const windows = windowCaptions(captions);
	assertChain(windows, captions);
	assert.equal(windows.length, 1);
	assert.equal(windows[0].t_end_s, 1 * 4 + 4);
	for (const w of windows) assert.ok(w.text.length <= HARD_MAX);
});
