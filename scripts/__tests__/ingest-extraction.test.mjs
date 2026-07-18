// Harness — unshaken-extraction (A2). Written BEFORE implementation; the
// initial run MUST fail (modules absent) — that failure is the proof it
// exercises the SUT, not a mock of it. Maps plan.md H1–H9.
// Run: node --test scripts/__tests__/ingest-extraction.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

import {
	chapterAt,
	stampChunks,
	chunkUtterances,
	prefilterCandidates,
	detectChapterTransitions,
	parseSpokenVerseRefs,
	detectForeignWindows,
	aliasMatchCandidates,
	resolveVerseRef,
	validateMention,
	dedupeMentions,
	aggregateToEdges,
	assembleEpisode,
	seedTraps,
	stratifiedSample,
	buildExtractionSchema,
	buildChunkPrompt,
	buildTimelinePrompt,
	formatSeqLine,
} from '../ingest-podcast/extract-lib.mjs';
import {
	buildExtractionLoadPlan,
	EXISTING_EDGES_SQL,
} from '../ingest-podcast/load-extraction.mjs';
import { verifyQuoteAtSeq, validateAliasTable } from '../ingest-podcast/extract-lib.mjs';
import { makeScrubber } from '../ingest-podcast/util.mjs';

// ---------- fixtures ----------

const TIMELINE = [
	{ t_start_s: 0, chapter: '2-kgs-14' },
	{ t_start_s: 1200, chapter: '2-kgs-15' },
	{ t_start_s: 2400, chapter: '2-kgs-16' },
];

function utt(seq, t, text) {
	return { seq, t_start_s: t, text };
}

const POOL = {
	person: [
		{ id: 'person-hezekiah', name: 'Hezekiah' },
		{ id: 'person-sennacherib', name: 'Sennacherib' },
		{ id: 'person-ai-dweller', name: 'Ai' }, // word-boundary trap
	],
	place: [{ id: 'place-mount-carmel', name: 'Mount Carmel' }],
	event: [],
	principle: [
		{ id: 'principle-faith', name: 'Faith' },
		{ id: 'principle-repentance', name: 'Repentance' },
	],
	symbol: [],
};

const EPISODE_CHAPTERS = ['2-kgs-14', '2-kgs-15', '2-kgs-16'];
const VERSE_EXISTS = (id) => {
	// 2-kgs-14 has 29 verses; -15 has 38; -16 has 20 (fixture truth)
	const m = id.match(/^(2-kgs-\d+)-(\d+)$/);
	if (!m) return false;
	const max = { '2-kgs-14': 29, '2-kgs-15': 38, '2-kgs-16': 20 }[m[1]];
	return Boolean(max) && Number(m[2]) >= 1 && Number(m[2]) <= max;
};

function mention(over = {}) {
	return {
		kind: 'person',
		target: 'person-hezekiah',
		seq: 10,
		t: 100,
		confidence: 0.9,
		quote: 'Hezekiah trusted the Lord',
		...over,
	};
}

// ---------- H1: timeline → chunk stamping ----------

test('H1: chapterAt returns governing chapter for t', () => {
	assert.equal(chapterAt(TIMELINE, 0), '2-kgs-14');
	assert.equal(chapterAt(TIMELINE, 1199.9), '2-kgs-14');
	assert.equal(chapterAt(TIMELINE, 1200), '2-kgs-15');
	assert.equal(chapterAt(TIMELINE, 9999), '2-kgs-16');
});

test('H1: chunk fully inside one segment stamps one chapter', () => {
	const chunks = [{ tStart: 100, tEnd: 900, utterances: [] }];
	const [stamped] = stampChunks(chunks, TIMELINE);
	assert.deepEqual(stamped.chapterContext, ['2-kgs-14']);
});

test('H1: mid-chunk transition stamps BOTH chapters in order', () => {
	const chunks = [{ tStart: 1100, tEnd: 1300, utterances: [] }];
	const [stamped] = stampChunks(chunks, TIMELINE);
	assert.deepEqual(stamped.chapterContext, ['2-kgs-14', '2-kgs-15']);
});

test('H1: pre-first-segment chunks are FLAGGED, never guessed (panel-2 A9)', () => {
	// intros recap the PREVIOUS episode — stamping the first block chapter
	// would manufacture wrong-but-existing edges. Flag for review; refs drop.
	const timeline = [{ t_start_s: 300, chapter: '2-kgs-14' }];
	const chunks = [{ tStart: 0, tEnd: 200, utterances: [] }];
	const [stamped] = stampChunks(chunks, timeline);
	assert.deepEqual(stamped.chapterContext, []);
	assert.equal(stamped.preSegment, true);
});

// ---------- chunking ----------

test('chunking: windows advance by size-overlap, all utterances covered', () => {
	const utterances = Array.from({ length: 130 }, (_, i) => utt(i, i * 10, `u${i}`));
	const chunks = chunkUtterances(utterances, { size: 50, overlap: 10 });
	assert.equal(chunks[0].utterances.length, 50);
	assert.equal(chunks[1].utterances[0].seq, 40); // 50 - 10
	const seen = new Set(chunks.flatMap((c) => c.utterances.map((u) => u.seq)));
	assert.equal(seen.size, 130);
	for (const c of chunks) {
		assert.equal(c.tStart, c.utterances[0].t_start_s);
	}
});

test('chunking: short tail window is emitted, never dropped', () => {
	const utterances = Array.from({ length: 55 }, (_, i) => utt(i, i, `u${i}`));
	const chunks = chunkUtterances(utterances, { size: 50, overlap: 10 });
	const last = chunks.at(-1);
	assert.ok(last.utterances.at(-1).seq === 54);
});

test('formatSeqLine: [seq @ mm:ss] shape', () => {
	assert.equal(formatSeqLine(utt(7, 754.3, 'let us begin')), '[7 @ 12:34] let us begin');
});

test('formatSeqLine: hours appear past 60m (3.6h episodes are real)', () => {
	assert.equal(formatSeqLine(utt(9, 13000.5, 'late remark')), '[9 @ 3:36:40] late remark');
});

// ---------- deterministic extractors (Revision 1: code IS the extractor) ----------

const BOOK_CTX = {
	episodeChapters: EPISODE_CHAPTERS,
	bookAliases: { '2 Kings': '2-kgs', 'Second Kings': '2-kgs' },
};

test('transitions: announced chapter, digits and number-words', () => {
	const us = [
		utt(0, 10, 'welcome to chapter 14 of Second Kings'),
		utt(1, 1200, 'now chapter fifteen begins with Azariah'),
	];
	const segs = detectChapterTransitions(us, BOOK_CTX);
	assert.deepEqual(
		segs.map((s) => [s.chapter, s.t_start_s]),
		[['2-kgs-14', 10], ['2-kgs-15', 1200]],
	);
});

test('transitions: INLINE entry "in verse three of Second Kings 21" (panel F2)', () => {
	const us = [
		utt(0, 10, 'chapter 20 closes with Hezekiah'),
		utt(1, 500, 'In verse three of Second Kings 21 we meet Manasseh'),
	];
	const segs = detectChapterTransitions(us, {
		...BOOK_CTX,
		episodeChapters: ['2-kgs-20', '2-kgs-21'],
	});
	assert.equal(segs.at(-1).chapter, '2-kgs-21');
	assert.equal(segs.at(-1).t_start_s, 500);
});

test('transitions: chapters outside the episode block are never emitted', () => {
	const us = [utt(0, 10, 'back in chapter 5 Naaman was healed')]; // ch 5 ∉ block
	const segs = detectChapterTransitions(us, BOOK_CTX);
	assert.deepEqual(segs, []);
});

test('spoken refs: digits, number-words, and anaphoric bare forms', () => {
	assert.deepEqual(parseSpokenVerseRefs('let us start with verse three'), [{ verse: 3 }]);
	assert.deepEqual(parseSpokenVerseRefs('now verse 4 says'), [{ verse: 4 }]);
	assert.deepEqual(parseSpokenVerseRefs('in verse twenty three we read'), [{ verse: 23 }]);
});

test('spoken refs: ranges — "from verse four to verse 24" (panel F5)', () => {
	assert.deepEqual(parseSpokenVerseRefs('from verse four to verse 24'), [
		{ verse: 4, verseEnd: 24 },
	]);
});

test('spoken refs: elided pair "verse twenty one and two" = 21–22 (panel F5)', () => {
	assert.deepEqual(parseSpokenVerseRefs('look at verse twenty one and two'), [
		{ verse: 21, verseEnd: 22 },
	]);
});

test('spoken refs: "verses nine and ten" = enumeration, not range to 10', () => {
	assert.deepEqual(parseSpokenVerseRefs('verses nine and ten teach this'), [
		{ verse: 9, verseEnd: 10 },
	]);
});

test('spoken refs: "verses 23 through 25" — "through" range word (census)', () => {
	assert.deepEqual(parseSpokenVerseRefs('read verses 23 through 25 with me'), [
		{ verse: 23, verseEnd: 25 },
	]);
});

test('spoken refs: "next verse" emits a relative marker for stateful resolution', () => {
	assert.deepEqual(parseSpokenVerseRefs('and the next verse says'), [{ relative: 1 }]);
});

test('spoken refs: bare numerals fail CLOSED — census surfaces them, parser never guesses', () => {
	assert.deepEqual(parseSpokenVerseRefs('now 24 continues the story'), []);
});

test('foreign windows: "section" unit — D&C tangents (census: 120×/85×)', () => {
	const us = [utt(0, 50, 'in Doctrine and Covenants section 76 we learn of glories')];
	const windows = detectForeignWindows(us, {
		foreignBooks: { 'Doctrine and Covenants': 'dc', 'Second Chronicles': '2-chr' },
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].book, 'dc');
});

test('foreign windows: cross-book citation opens a tangent (panel F3)', () => {
	const us = [
		utt(0, 10, 'verse nine of our chapter'),
		utt(1, 100, 'turn with me to Second Chronicles 28 for the fuller account'),
		utt(2, 130, 'verse nine and ten there are devastating'),
		utt(3, 400, 'coming back to our chapter in verse 12'),
	];
	const windows = detectForeignWindows(us, {
		foreignBooks: { 'Second Chronicles': '2-chr', Helaman: 'hel' },
	});
	assert.equal(windows.length, 1);
	assert.equal(windows[0].book, '2-chr');
	assert.ok(windows[0].tStart <= 100 && windows[0].tEnd >= 130);
});

test('alias match: ASR variant "Ahas" resolves to Ahaz (panel F1)', () => {
	const table = [
		{ id: 'person-ahaz', names: ['Ahaz', 'Ahas'] },
		{ id: 'person-hezekiah', names: ['Hezekiah'] },
	];
	const hits = aliasMatchCandidates('and ahas his father trembled', table);
	assert.deepEqual(hits.map((h) => h.id), ['person-ahaz']);
});

test('alias match: word boundaries hold for aliases too', () => {
	const table = [{ id: 'person-ahaz', names: ['Ahaz', 'Ahas'] }];
	assert.deepEqual(aliasMatchCandidates('he purchases the field', table), []);
});

// ---------- candidate prefilter ----------

test('prefilter: case-insensitive whole-word name match', () => {
	const text = 'and hezekiah prayed while Sennacherib mocked';
	const got = prefilterCandidates(text, POOL);
	const ids = got.named.map((c) => c.id).sort();
	assert.deepEqual(ids, ['person-hezekiah', 'person-sennacherib']);
});

test('prefilter: word boundaries — "Ai" never matches inside "again"', () => {
	const got = prefilterCandidates('and again he said', POOL);
	assert.deepEqual(got.named, []);
});

test('prefilter: multi-word names match across spaces', () => {
	const got = prefilterCandidates('they went up to mount carmel that day', POOL);
	assert.deepEqual(got.named.map((c) => c.id), ['place-mount-carmel']);
});

test('prefilter: principles always ride along in full (thematic pool)', () => {
	const got = prefilterCandidates('nothing matches here', POOL);
	assert.deepEqual(got.principles.map((c) => c.id).sort(), [
		'principle-faith',
		'principle-repentance',
	]);
});

// ---------- H3: verse resolution fail-closed ----------

test('H3: valid ref resolves to spine id', () => {
	const r = resolveVerseRef(
		{ chapter_ctx: '2-kgs-14', verse_num: 3 },
		{ episodeChapters: EPISODE_CHAPTERS, verseExists: VERSE_EXISTS },
	);
	assert.deepEqual(r, { id: '2-kgs-14-3' });
});

test('H3: chapter outside episode block → dropped with reason, no throw', () => {
	const r = resolveVerseRef(
		{ chapter_ctx: '2-kgs-13', verse_num: 3 },
		{ episodeChapters: EPISODE_CHAPTERS, verseExists: VERSE_EXISTS },
	);
	assert.equal(r.id, null);
	assert.match(r.reason, /outside episode/i);
});

test('H3: nonexistent verse → dropped with reason', () => {
	const r = resolveVerseRef(
		{ chapter_ctx: '2-kgs-16', verse_num: 99 },
		{ episodeChapters: EPISODE_CHAPTERS, verseExists: VERSE_EXISTS },
	);
	assert.equal(r.id, null);
	assert.match(r.reason, /no such verse/i);
});

test('H3: malformed ref (verse 0, non-int) → dropped, never fabricated', () => {
	for (const verse_num of [0, -1, 1.5, 'three']) {
		const r = resolveVerseRef(
			{ chapter_ctx: '2-kgs-14', verse_num },
			{ episodeChapters: EPISODE_CHAPTERS, verseExists: VERSE_EXISTS },
		);
		assert.equal(r.id, null, `verse_num=${verse_num} must not resolve`);
	}
});

// ---------- H4: closed vocab + range validation in CODE ----------

test('H4: mention with target outside pool is rejected', () => {
	const poolIds = new Set(['person-hezekiah']);
	const bad = mention({ target: 'person-made-up' });
	const r = validateMention(bad, { poolIds });
	assert.equal(r.ok, false);
	assert.match(r.reason, /not in pool/i);
});

test('H4: confidence outside [0,1] rejected in code (schema cannot)', () => {
	const poolIds = new Set(['person-hezekiah']);
	for (const confidence of [-0.1, 1.1, NaN]) {
		const r = validateMention(mention({ confidence }), { poolIds });
		assert.equal(r.ok, false, `confidence=${confidence} must fail`);
	}
	assert.equal(validateMention(mention(), { poolIds }).ok, true);
});

test('H4: below write-floor (0.5) rejected with distinct reason', () => {
	const poolIds = new Set(['person-hezekiah']);
	const r = validateMention(mention({ confidence: 0.4 }), { poolIds });
	assert.equal(r.ok, false);
	assert.match(r.reason, /floor/i);
});

// ---------- H2: dedupe ----------

test('H2: same target within ±5s merges, keeps higher confidence', () => {
	const a = mention({ t: 100, confidence: 0.8 });
	const b = mention({ t: 103, confidence: 0.95, seq: 11 });
	const out = dedupeMentions([a, b]);
	assert.equal(out.length, 1);
	assert.equal(out[0].confidence, 0.95);
});

test('H2: same target >5s apart stays as two mentions', () => {
	const a = mention({ t: 100 });
	const b = mention({ t: 106.1, seq: 12 });
	assert.equal(dedupeMentions([a, b]).length, 2);
});

test('H2: different targets at same t both survive', () => {
	const a = mention({ t: 100 });
	const b = mention({ t: 100, target: 'person-sennacherib' });
	assert.equal(dedupeMentions([a, b]).length, 2);
});

// ---------- aggregation ----------

test('aggregate: one edge per (target, rel_type), mentions sorted by t', () => {
	const ms = [
		mention({ t: 300 }),
		mention({ t: 100, seq: 2 }),
		mention({ kind: 'principle', target: 'principle-faith', t: 50 }),
	];
	const edges = aggregateToEdges(ms, { episodeId: 'unshaken-x' });
	assert.equal(edges.length, 2);
	const hez = edges.find((e) => e.toId === 'person-hezekiah');
	assert.equal(hez.relType, 'MENTIONS');
	assert.deepEqual(hez.mentions.map((m) => m.t), [100, 300]);
	const faith = edges.find((e) => e.toId === 'principle-faith');
	assert.equal(faith.relType, 'TEACHES');
});

test('aggregate: verse/chapter kinds map to DISCUSSES', () => {
	const ms = [mention({ kind: 'verse', target: '2-kgs-14-3' })];
	const [e] = aggregateToEdges(ms, { episodeId: 'unshaken-x' });
	assert.equal(e.relType, 'DISCUSSES');
});

// ---------- H5: batch assembly keyed by custom_id ----------

test('H5: results keyed by custom_id, order-independent', () => {
	const results = [
		{ custom_id: 'unshaken-x:p2:1', mentions: [mention({ seq: 60 })] },
		{ custom_id: 'unshaken-x:p2:0', mentions: [mention({ seq: 5 })] },
	];
	const a = assembleEpisode('unshaken-x', results, { expectedChunks: 2 });
	const b = assembleEpisode('unshaken-x', [...results].reverse(), { expectedChunks: 2 });
	assert.deepEqual(a, b);
	assert.equal(a.complete, true);
});

test('H5: missing chunk → episode incomplete, mentions withheld', () => {
	const results = [{ custom_id: 'unshaken-x:p2:0', mentions: [mention()] }];
	const a = assembleEpisode('unshaken-x', results, { expectedChunks: 3 });
	assert.equal(a.complete, false);
	assert.deepEqual(a.missingChunks, [1, 2]);
});

test('H5: foreign-episode results are ignored, not absorbed', () => {
	const results = [
		{ custom_id: 'unshaken-x:p2:0', mentions: [mention()] },
		{ custom_id: 'unshaken-OTHER:p2:0', mentions: [mention({ target: 'person-sennacherib' })] },
	];
	const a = assembleEpisode('unshaken-x', results, { expectedChunks: 1 });
	assert.equal(a.mentions.length, 1);
	assert.equal(a.mentions[0].target, 'person-hezekiah');
});

// ---------- H6 + H7: load plan (UPDATE vs INSERT, idempotent delete) ----------

const EXISTING_TITLE_EDGES = [
	{
		from_id: 'unshaken-x',
		to_id: '2-kgs-14',
		rel_type: 'DISCUSSES',
		source: 'unshaken-youtube',
		metadata: { source: 'title', confidence: 1, mentions: [{ t: 999, seq: 99, confidence: 0.7 }] },
	},
	{
		from_id: 'unshaken-x',
		to_id: '2-kgs-15',
		rel_type: 'DISCUSSES',
		source: 'unshaken-youtube',
		metadata: { source: 'title', confidence: 1, mentions: [] },
	},
];

function planFixture() {
	const edges = [
		{ toId: '2-kgs-14', relType: 'DISCUSSES', mentions: [{ t: 10, seq: 1, confidence: 0.9 }] }, // exists → UPDATE
		{ toId: '2-kgs-14-3', relType: 'DISCUSSES', mentions: [{ t: 12, seq: 2, confidence: 0.9 }] }, // new → INSERT
		{ toId: 'person-hezekiah', relType: 'MENTIONS', mentions: [{ t: 14, seq: 3, confidence: 0.8 }] },
	];
	return buildExtractionLoadPlan({
		episodeId: 'unshaken-x',
		collectionId: 'unshaken',
		edges,
		existingEdges: EXISTING_TITLE_EDGES,
	});
}

test('H6: existing title pair gets UPDATE, never INSERT (unique index)', () => {
	const plan = planFixture();
	const inserts = plan.statements.filter((s) => s.kind === 'insert-edge');
	const updates = plan.statements.filter((s) => s.kind === 'update-title-edge');
	assert.ok(updates.some((s) => s.toId === '2-kgs-14'));
	assert.ok(!inserts.some((s) => s.toId === '2-kgs-14'));
	assert.ok(inserts.some((s) => s.toId === '2-kgs-14-3'));
	assert.ok(inserts.some((s) => s.toId === 'person-hezekiah'));
});

test('H6: title-edge UPDATE keeps source column + confidence-1 anchor (F4)', () => {
	const plan = planFixture();
	const up = plan.statements.find((s) => s.kind === 'update-title-edge');
	assert.equal(up.source, 'unshaken-youtube'); // A1 ownership untouched
	assert.equal(up.metadata.confidence, 1);
	assert.ok(Array.isArray(up.metadata.mentions) && up.metadata.mentions.length > 0);
});

test('H7: delete scopes on first-class source column, THIS episode only (F4)', () => {
	const plan = planFixture();
	const del = plan.statements.find((s) => s.kind === 'delete-extraction-edges');
	assert.equal(del.episodeId, 'unshaken-x');
	assert.equal(del.collectionId, 'unshaken');
	assert.equal(del.sourceFilter, 'unshaken-extraction');
});

test('H7: title-sourced (unshaken-youtube) edges never deletable', () => {
	const plan = planFixture();
	for (const s of plan.statements) {
		if (s.kind.startsWith('delete')) {
			assert.notEqual(s.sourceFilter, 'unshaken-youtube');
			assert.equal(s.sourceFilter, 'unshaken-extraction');
		}
	}
});

test('H6b: inserted extraction edges carry source column + mentions', () => {
	const plan = planFixture();
	for (const s of plan.statements.filter((x) => x.kind === 'insert-edge')) {
		assert.equal(s.source, 'unshaken-extraction');
		assert.ok(Array.isArray(s.metadata.mentions));
	}
});

test('PW-A2: extraction-sourced existing pair classifies INSERT, never UPDATE', () => {
	// Run-2 self-destruction path: misclassifying run-1's own edges as title
	// edges makes delete-then-UPDATE hit 0 rows and exit 0. Source column
	// decides; only unshaken-youtube rows are update candidates.
	const edges = [
		{ toId: '2-kgs-14-3', relType: 'DISCUSSES', mentions: [{ t: 12, seq: 2, confidence: 0.9 }] },
	];
	const plan = buildExtractionLoadPlan({
		episodeId: 'unshaken-x',
		collectionId: 'unshaken',
		edges,
		existingEdges: [
			...EXISTING_TITLE_EDGES,
			{
				from_id: 'unshaken-x',
				to_id: '2-kgs-14-3',
				rel_type: 'DISCUSSES',
				source: 'unshaken-extraction',
				metadata: { mentions: [] },
			},
		],
	});
	const kinds = plan.statements.filter((s) => s.toId === '2-kgs-14-3').map((s) => s.kind);
	assert.deepEqual(kinds, ['insert-edge']);
});

test('PW-A2: classification fetch SQL exported + title-source-filtered', () => {
	assert.match(EXISTING_EDGES_SQL, /source\s*=\s*'unshaken-youtube'/);
	assert.doesNotMatch(EXISTING_EDGES_SQL, /metadata\s*->>/); // column, never jsonb path
});

test('PW-A3: plan opens with a metadata-repaired preflight statement', () => {
	// A load against unrepaired string-typed rows must abort loud before any
	// write — live-probed: merge-updating a string scalar makes jsonb ARRAYS.
	const plan = planFixture();
	assert.equal(plan.statements[0].kind, 'assert-metadata-repaired');
});

test('PW-A4: title UPDATE replaces mentions with EXACTLY the fresh set', () => {
	// Append semantics would double mentions per re-run and make stale
	// wrong-alias-era mentions immortal. Replace mirrors delete+insert.
	const plan = planFixture();
	const up = plan.statements.find((s) => s.kind === 'update-title-edge' && s.toId === '2-kgs-14');
	assert.deepEqual(up.metadata.mentions, [{ t: 10, seq: 1, confidence: 0.9 }]); // stale t:999 gone
});

test('PW-A7: judged mentions with fabricated quotes die in code, not in the sample', () => {
	const utterances = [
		utt(9, 90, 'and before this'),
		utt(10, 100, 'Hezekiah trusted the Lord with all his heart'),
		utt(11, 110, 'and after that'),
	];
	const ok = verifyQuoteAtSeq(mention({ quote: 'trusted the Lord' }), { utterances });
	assert.equal(ok.ok, true);
	const bad = verifyQuoteAtSeq(mention({ quote: 'a phrase never spoken' }), { utterances });
	assert.equal(bad.ok, false);
	assert.match(bad.reason, /quote/i);
});

test('PW-A7: quote may land on seq±1 (utterance boundaries wobble), normalized', () => {
	const utterances = [
		utt(9, 90, 'Hezekiah trusted'),
		utt(10, 100, 'the Lord always'),
		utt(11, 110, 'x'),
	];
	const r = verifyQuoteAtSeq(mention({ seq: 10, quote: 'hezekiah trusted' }), { utterances });
	assert.equal(r.ok, true);
});

test('EV-A10: alias tables census/pool-validated; collisions routed, never first-win', () => {
	const censusTokens = new Set(['ahas', 'joram', 'hezekiah']);
	const poolIds = new Set(['person-ahaz', 'person-joram-israel', 'person-jehoram-judah']);
	const table = [
		{ id: 'person-ahaz', names: ['Ahas'] },
		{ id: 'person-made-up', names: ['Hezekiah'] }, // id outside pool → rejected
		{ id: 'person-ahaz', names: ['Achaz'] }, // alias not in census → rejected
		{ id: 'person-joram-israel', names: ['Joram'] },
		{ id: 'person-jehoram-judah', names: ['Joram'] }, // two claimants → collision
	];
	const r = validateAliasTable(table, { censusTokens, poolIds });
	assert.deepEqual(r.valid.map((v) => [v.id, v.names[0]]), [['person-ahaz', 'Ahas']]);
	assert.equal(r.rejected.length, 2);
	assert.equal(r.collisions.length, 1);
	assert.equal(r.collisions[0].token.toLowerCase(), 'joram');
	assert.equal(r.collisions[0].ids.length, 2);
});

test('F1-regression: jsonb statement values are OBJECTS, never pre-stringified', () => {
	// Prod carries 184 double-encoded rows because the A1 executor stringified
	// before postgres.js serialized. The repaired contract: builders emit raw
	// objects; the executor serializes EXACTLY once. Pin it at the builder.
	const plan = planFixture();
	for (const s of plan.statements) {
		if (s.metadata !== undefined) {
			assert.equal(typeof s.metadata, 'object');
			assert.notEqual(typeof s.metadata, 'string');
		}
	}
});

// ---------- H8: trap containment ----------

test('H8: traps are target-swapped REAL mentions, indistinguishable in-sample (panel-2 A2)', () => {
	const clean = [
		mention(),
		mention({ t: 200, seq: 20, target: 'person-sennacherib', quote: 'Sennacherib mocked from the wall' }),
	];
	const before = JSON.stringify(clean);
	const rng = () => 0.5;
	const { evalSample, answerKey } = seedTraps(clean, {
		count: 1,
		rng,
		swapPool: ['person-hezekiah', 'person-sennacherib', 'person-ahaz'],
	});
	assert.equal(JSON.stringify(clean), before); // input untouched
	// indistinguishable: every entry carries the SAME key set, no marker field
	const keySets = new Set(evalSample.map((m) => Object.keys(m).sort().join(',')));
	assert.equal(keySets.size, 1);
	assert.ok(!evalSample.some((m) => '__trap' in m));
	// trap quote is a REAL quote from the input (grep-proof), target swapped
	assert.equal(answerKey.traps.length, 1);
	for (const trap of answerKey.traps) {
		const entry = evalSample[trap.index];
		assert.ok(clean.some((m) => m.quote === entry.quote));
		assert.equal(entry.target, trap.swappedTarget);
		assert.notEqual(trap.swappedTarget, trap.originalTarget);
	}
	// answer key is a SEPARATE return, never embedded in the sample artifact
	assert.ok(!JSON.stringify(evalSample).includes('swappedTarget'));
});

test('H8: load-plan builder REFUSES any object carrying __trap', () => {
	assert.throws(
		() =>
			buildExtractionLoadPlan({
				episodeId: 'unshaken-x',
				collectionId: 'unshaken',
				edges: [{ toId: 'person-hezekiah', relType: 'MENTIONS', mentions: [], __trap: true }],
				existingEdges: [],
			}),
		/trap/i,
	);
});

// ---------- sampling ----------

test('sampling: deterministic under injected rng, 12 per episode cap', () => {
	const ms = Array.from({ length: 40 }, (_, i) =>
		mention({ t: i * 10, seq: i, kind: i % 2 ? 'verse' : 'person', target: i % 2 ? '2-kgs-14-3' : 'person-hezekiah' }),
	);
	const rng = () => 0.42;
	const a = stratifiedSample(ms, { perEpisode: 12, rng });
	const b = stratifiedSample(ms, { perEpisode: 12, rng: () => 0.42 });
	assert.equal(a.length, 12);
	assert.deepEqual(a, b);
	assert.ok(a.some((m) => m.kind === 'verse') && a.some((m) => m.kind === 'person'));
});

// ---------- schema + prompts ----------

test('schema: strict object, additionalProperties false, kind enum closed', () => {
	const s = buildExtractionSchema();
	assert.equal(s.type, 'object');
	assert.equal(s.additionalProperties, false);
	const item = s.properties.mentions.items;
	assert.equal(item.additionalProperties, false);
	assert.deepEqual(
		[...item.properties.kind.enum].sort(),
		['chapter', 'event', 'person', 'place', 'principle', 'verse'],
	);
	for (const k of ['kind', 'target_hint', 'seq', 't', 'confidence', 'quote']) {
		assert.ok(item.required.includes(k), `${k} required`);
	}
});

test('prompts: chunk prompt carries chapter context, candidates, seq lines', () => {
	const chunk = {
		tStart: 100,
		tEnd: 200,
		chapterContext: ['2-kgs-14'],
		utterances: [utt(1, 100, 'Hezekiah prayed')],
	};
	const p = buildChunkPrompt(chunk, {
		candidates: { named: [POOL.person[0]], principles: POOL.principle },
		episodeTitle: 'Come Follow Me - 2 Kings 14-25',
	});
	assert.match(p, /2-kgs-14/);
	assert.match(p, /person-hezekiah/);
	assert.match(p, /\[1 @ 01:40\] Hezekiah prayed/);
});

test('prompts: timeline prompt lists episode chapters as the closed set', () => {
	const p = buildTimelinePrompt({
		episodeChapters: EPISODE_CHAPTERS,
		lines: ['[0 @ 00:00] welcome'],
	});
	for (const ch of EPISODE_CHAPTERS) assert.match(p, new RegExp(ch));
});

// ---------- H9: secrets ----------

test('H9: scrubber removes ANTHROPIC_API_KEY material from error text', () => {
	const scrub = makeScrubber('sk-ant-api03-FAKEFAKE');
	const dirty = `401 unauthorized: key sk-ant-api03-FAKEFAKE rejected`;
	assert.ok(!scrub(dirty).includes('FAKEFAKE'));
});

test('H9: prompts and schema never embed key material', () => {
	const chunk = { tStart: 0, tEnd: 1, chapterContext: ['2-kgs-14'], utterances: [utt(0, 0, 'x')] };
	const p = buildChunkPrompt(chunk, {
		candidates: { named: [], principles: [] },
		episodeTitle: 't',
	});
	assert.ok(!/sk-ant/.test(p));
	assert.ok(!/sk-ant/.test(JSON.stringify(buildExtractionSchema())));
});
