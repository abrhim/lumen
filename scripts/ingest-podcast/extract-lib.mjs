// Pure extraction cores (unshaken-extraction A2, Revision 1: deterministic
// code extracts; workflow subagents judge). No IO, no clients — everything
// injected. Contracts pinned by scripts/__tests__/ingest-extraction.test.mjs.

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ── spoken numbers ──────────────────────────────────────────────────────────

const WORD_VALUES = {
	one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
	nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
	fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
	twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
	eighty: 80, ninety: 90,
};

const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const ONES = 'one|two|three|four|five|six|seven|eight|nine';
const TEENS = 'ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen';
// order matters: compound before bare tens, teens before ones
const NUMWORD = `(?:(?:${TENS})(?:[ -](?:${ONES}))?|(?:${TEENS})|(?:${ONES}))`;
const NUM = `(\\d{1,3}|${NUMWORD})`;

/** "23" | "twenty three" | "twenty-three" → 23; NaN if unparseable. */
export function spokenNumberToInt(raw) {
	const s = String(raw).toLowerCase().replace(/-/g, ' ').trim();
	if (/^\d+$/.test(s)) return Number(s);
	let total = 0;
	for (const tok of s.split(/\s+/)) {
		const v = WORD_VALUES[tok];
		if (v === undefined) return NaN;
		total += v;
	}
	return total;
}

// ── timestamps ──────────────────────────────────────────────────────────────

/** `[seq @ mm:ss]` (hours appear past 60m — 3.6h episodes are real). */
export function formatSeqLine(u) {
	const total = Math.floor(u.t_start_s);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	const p = (x) => String(x).padStart(2, '0');
	const stamp = h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
	return `[${u.seq} @ ${stamp}] ${u.text}`;
}

// ── chunking + chapter stamping ─────────────────────────────────────────────

/** Sliding utterance windows; every utterance lands in ≥1 window. */
export function chunkUtterances(utterances, { size, overlap }) {
	const step = Math.max(1, size - overlap);
	const chunks = [];
	for (let start = 0; start < utterances.length; start += step) {
		const slice = utterances.slice(start, start + size);
		if (!slice.length) break;
		chunks.push({
			tStart: slice[0].t_start_s,
			tEnd: slice.at(-1).t_start_s,
			utterances: slice,
		});
		if (start + size >= utterances.length) break;
	}
	return chunks;
}

/** Governing chapter for a moment: last segment at or before t. */
export function chapterAt(timeline, t) {
	const sorted = [...timeline].sort((a, b) => a.t_start_s - b.t_start_s);
	let current = null;
	for (const seg of sorted) {
		if (seg.t_start_s <= t) current = seg.chapter;
		else break;
	}
	return current ?? sorted[0]?.chapter ?? null;
}

/** Stamp chunks with governing + in-window chapters. Pre-first-segment
 * chunks are FLAGGED, never guessed (intros recap the previous episode —
 * panel-2 A9). */
export function stampChunks(chunks, timeline) {
	const sorted = [...timeline].sort((a, b) => a.t_start_s - b.t_start_s);
	return chunks.map((c) => {
		let governing = null;
		for (const seg of sorted) {
			if (seg.t_start_s <= c.tStart) governing = seg.chapter;
			else break;
		}
		const ctx = governing ? [governing] : [];
		for (const seg of sorted) {
			if (seg.t_start_s > c.tStart && seg.t_start_s <= c.tEnd && !ctx.includes(seg.chapter)) {
				ctx.push(seg.chapter);
			}
		}
		if (!governing) return { ...c, chapterContext: ctx, preSegment: true };
		return { ...c, chapterContext: ctx };
	});
}

// ── deterministic extractors ────────────────────────────────────────────────

/** Chapter-transition segments from announced ("chapter fifteen") and
 * INLINE ("of Second Kings 21" — panel F2) forms. Chapters outside the
 * episode block are never emitted (census surfaces them instead). */
export function detectChapterTransitions(utterances, { episodeChapters, bookAliases }) {
	const blockByBook = new Map();
	for (const ch of episodeChapters) {
		const m = ch.match(/^(.+)-(\d+)$/);
		if (!m) continue;
		if (!blockByBook.has(m[1])) blockByBook.set(m[1], new Set());
		blockByBook.get(m[1]).add(Number(m[2]));
	}
	const aliasEntries = Object.entries(bookAliases ?? {});
	const segs = [];
	for (const u of utterances) {
		const found = [];
		for (const [alias, bookId] of aliasEntries) {
			const re = new RegExp(`\\b${esc(alias)}\\s+${NUM}\\b`, 'gi');
			for (const m of u.text.matchAll(re)) {
				found.push({ idx: m.index, bookId, num: spokenNumberToInt(m[1]) });
			}
		}
		const chRe = new RegExp(`\\bchapter\\s+${NUM}\\b`, 'gi');
		for (const m of u.text.matchAll(chRe)) {
			const num = spokenNumberToInt(m[1]);
			const books = [...blockByBook].filter(([, set]) => set.has(num)).map(([b]) => b);
			if (books.length === 1) found.push({ idx: m.index, bookId: books[0], num });
		}
		found.sort((a, b) => a.idx - b.idx);
		for (const f of found) {
			if (!Number.isInteger(f.num) || !blockByBook.get(f.bookId)?.has(f.num)) continue;
			const chapter = `${f.bookId}-${f.num}`;
			if (segs.at(-1)?.chapter === chapter) continue;
			segs.push({ chapter, t_start_s: u.t_start_s, evidence: u.text });
		}
	}
	return segs;
}

/** Explicit "verse" refs only: digits, number-words, ranges ("to"/"through"),
 * elided pairs ("twenty one and two" = 21–22), relative markers ("next
 * verse"). Bare numerals fail CLOSED — the coverage census surfaces them. */
export function parseSpokenVerseRefs(text) {
	const t = String(text);
	const spans = [];
	const collect = (re, handler) => {
		for (const m of t.matchAll(re)) {
			spans.push({ start: m.index, end: m.index + m[0].length, out: handler(m) });
		}
	};
	// ranges: "verse(s) X to/through (verse) Y"
	collect(
		new RegExp(`\\bverses?\\s+${NUM}\\s+(?:to|through)\\s+(?:verses?\\s+)?${NUM}\\b`, 'gi'),
		(m) => {
			const a = spokenNumberToInt(m[1]);
			const b = spokenNumberToInt(m[2]);
			return b > a ? [{ verse: a, verseEnd: b }] : [{ verse: a }];
		},
	);
	// pairs: "verse(s) X and Y" — consecutive → range; elision (21 and 2 =
	// 21–22); otherwise two singles
	collect(new RegExp(`\\bverses?\\s+${NUM}\\s+and\\s+${NUM}\\b`, 'gi'), (m) => {
		const a = spokenNumberToInt(m[1]);
		const b = spokenNumberToInt(m[2]);
		if (b === a + 1) return [{ verse: a, verseEnd: b }];
		if (a >= 20 && b < 10) {
			const end = Math.floor(a / 10) * 10 + b;
			if (end > a) return [{ verse: a, verseEnd: end }];
		}
		return [{ verse: a }, { verse: b }];
	});
	// relative: "next/following verse"
	collect(/\b(?:next|following)\s+verse\b/gi, () => [{ relative: 1 }]);
	// singles: "verse X"
	collect(new RegExp(`\\bverses?\\s+${NUM}\\b`, 'gi'), (m) => [
		{ verse: spokenNumberToInt(m[1]) },
	]);

	// earliest-start wins; longer match wins at equal start; no overlaps
	spans.sort((a, b) => a.start - b.start || b.end - a.end);
	const out = [];
	let cursor = -1;
	for (const s of spans) {
		if (s.start <= cursor) continue;
		cursor = s.end - 1;
		out.push(...s.out);
	}
	return out.filter((r) => r.relative !== undefined || Number.isInteger(r.verse));
}

/** Cross-book tangent windows (panel F3; "section" unit for D&C). Close:
 * 15 consecutive utterances without foreign tokens (Q6), else end-of-input. */
export function detectForeignWindows(utterances, { foreignBooks, quietClose = 15 }) {
	const entries = Object.entries(foreignBooks ?? {});
	const windows = [];
	let open = null;
	let quiet = 0;
	for (const u of utterances) {
		let hit = null;
		for (const [alias, book] of entries) {
			if (new RegExp(`\\b${esc(alias)}\\b`, 'i').test(u.text)) {
				hit = book;
				break;
			}
		}
		if (hit) {
			if (open && open.book !== hit) {
				windows.push(open);
				open = { book: hit, tStart: u.t_start_s, tEnd: u.t_start_s };
			} else if (open) {
				open.tEnd = u.t_start_s;
			} else {
				open = { book: hit, tStart: u.t_start_s, tEnd: u.t_start_s };
			}
			quiet = 0;
		} else if (open) {
			quiet += 1;
			open.tEnd = u.t_start_s;
			if (quiet >= quietClose) {
				windows.push(open);
				open = null;
				quiet = 0;
			}
		}
	}
	if (open) windows.push(open);
	return windows;
}

// ── candidates + aliases ────────────────────────────────────────────────────

/** Word-boundary CI name match over the episode pool. Principles always
 * ride along in full (thematic linking can't be name-matched). */
export function prefilterCandidates(text, pool) {
	const named = [];
	for (const entry of [
		...(pool.person ?? []),
		...(pool.place ?? []),
		...(pool.event ?? []),
		...(pool.symbol ?? []),
	]) {
		if (new RegExp(`\\b${esc(entry.name)}\\b`, 'i').test(text)) named.push(entry);
	}
	return { named, principles: [...(pool.principle ?? [])] };
}

/** Alias-aware matcher (panel F1: "Ahas" 47×, "Ahaz" 0×). */
export function aliasMatchCandidates(text, aliasTable) {
	const hits = [];
	for (const entry of aliasTable) {
		if (
			entry.names.some((name) => new RegExp(`\\b${esc(name)}\\b`, 'i').test(text)) &&
			!hits.some((h) => h.id === entry.id)
		) {
			hits.push(entry);
		}
	}
	return hits;
}

/** Deterministic validation of agent-produced alias tables (EV-A10):
 * census membership, pool membership, collisions routed — never first-win. */
export function validateAliasTable(table, { censusTokens, poolIds }) {
	const rejected = [];
	const candidates = [];
	for (const row of table) {
		if (!poolIds.has(row.id)) {
			rejected.push({ row, reason: 'id not in pool' });
			continue;
		}
		const missing = row.names.filter((nm) => !censusTokens.has(nm.toLowerCase()));
		if (missing.length) {
			rejected.push({ row, reason: `alias not in census: ${missing.join(',')}` });
			continue;
		}
		candidates.push(row);
	}
	const claims = new Map();
	for (const row of candidates) {
		for (const nm of row.names) {
			const k = nm.toLowerCase();
			if (!claims.has(k)) claims.set(k, { token: nm, ids: new Set() });
			claims.get(k).ids.add(row.id);
		}
	}
	const colliding = [...claims.values()].filter((c) => c.ids.size > 1);
	const collidingTokens = new Set(colliding.map((c) => c.token.toLowerCase()));
	const collisions = colliding.map((c) => ({ token: c.token, ids: [...c.ids] }));
	const valid = candidates.filter(
		(row) => !row.names.some((nm) => collidingTokens.has(nm.toLowerCase())),
	);
	return { valid, rejected, collisions };
}

// ── validation ──────────────────────────────────────────────────────────────

/** Fail-closed spine resolution — never fabricate, never widen. */
export function resolveVerseRef(ref, { episodeChapters, verseExists }) {
	if (!episodeChapters.includes(ref.chapter_ctx)) {
		return { id: null, reason: `chapter ${ref.chapter_ctx} outside episode block` };
	}
	if (!Number.isInteger(ref.verse_num) || ref.verse_num < 1) {
		return { id: null, reason: `invalid verse number: ${ref.verse_num}` };
	}
	const id = `${ref.chapter_ctx}-${ref.verse_num}`;
	if (!verseExists(id)) return { id: null, reason: `no such verse: ${id}` };
	return { id };
}

/** Closed vocab + confidence bounds IN CODE (json-schema can't express
 * numeric ranges) + the 0.5 write floor. */
export function validateMention(m, { poolIds }) {
	if (!poolIds.has(m.target)) {
		return { ok: false, reason: `target ${m.target} not in pool` };
	}
	const c = m.confidence;
	if (typeof c !== 'number' || !Number.isFinite(c) || c < 0 || c > 1) {
		return { ok: false, reason: `confidence outside [0,1]: ${c}` };
	}
	if (c < 0.5) return { ok: false, reason: `below write floor 0.5: ${c}` };
	return { ok: true };
}

/** Fabricated-evidence gate (PW-A7): the quote must actually be spoken at
 * the cited seq (±1 — utterance boundaries wobble). */
export function verifyQuoteAtSeq(m, { utterances }) {
	const norm = (s) =>
		String(s).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
	const windowText = norm(
		utterances
			.filter((u) => Math.abs(u.seq - m.seq) <= 1)
			.map((u) => u.text)
			.join(' '),
	);
	if (!windowText) return { ok: false, reason: `no utterances at seq ${m.seq}±1 to verify quote` };
	if (!windowText.includes(norm(m.quote))) {
		return { ok: false, reason: `quote not found at seq ${m.seq}±1` };
	}
	return { ok: true };
}

// ── dedupe + aggregation ────────────────────────────────────────────────────

/** Overlap-window dedupe: same (kind,target) within ±5s merges, higher
 * confidence wins (Q2). */
export function dedupeMentions(mentions) {
	const groups = new Map();
	for (const m of mentions) {
		const k = `${m.kind}|${m.target}`;
		if (!groups.has(k)) groups.set(k, []);
		groups.get(k).push(m);
	}
	const out = [];
	for (const group of groups.values()) {
		const sorted = [...group].sort((a, b) => a.t - b.t);
		let kept = null;
		for (const m of sorted) {
			if (kept && m.t - kept.t <= 5) {
				if (m.confidence > kept.confidence) {
					out[out.indexOf(kept)] = m;
					kept = m;
				}
			} else {
				out.push(m);
				kept = m;
			}
		}
	}
	return out;
}

const REL_BY_KIND = {
	verse: 'DISCUSSES',
	chapter: 'DISCUSSES',
	person: 'MENTIONS',
	place: 'MENTIONS',
	event: 'MENTIONS',
	principle: 'TEACHES',
};

/** One edge per (target, rel_type); mentions sorted by t. */
export function aggregateToEdges(mentions, { episodeId }) {
	const edges = new Map();
	for (const m of mentions) {
		const relType = REL_BY_KIND[m.kind];
		if (!relType) continue;
		const k = `${m.target}|${relType}`;
		if (!edges.has(k)) {
			edges.set(k, { fromId: episodeId, toId: m.target, relType, mentions: [] });
		}
		edges.get(k).mentions.push({ t: m.t, seq: m.seq, confidence: m.confidence });
	}
	for (const e of edges.values()) e.mentions.sort((a, b) => a.t - b.t);
	return [...edges.values()];
}

// ── judgment-artifact assembly ──────────────────────────────────────────────

/** Keyed by custom_id (`<episode>:<pass>:<chunk>`), order-independent;
 * missing chunks fail the EPISODE, siblings continue (H5). */
export function assembleEpisode(episodeId, results, { expectedChunks }) {
	const byChunk = new Map();
	for (const r of results) {
		if (typeof r.custom_id !== 'string' || !r.custom_id.startsWith(`${episodeId}:`)) continue;
		const idx = Number(r.custom_id.split(':').at(-1));
		if (Number.isInteger(idx)) byChunk.set(idx, r);
	}
	const missingChunks = [];
	const mentions = [];
	for (let i = 0; i < expectedChunks; i += 1) {
		const r = byChunk.get(i);
		if (!r) missingChunks.push(i);
		else mentions.push(...(r.mentions ?? []));
	}
	return { episodeId, complete: missingChunks.length === 0, missingChunks, mentions };
}

// ── eval mechanics ──────────────────────────────────────────────────────────

/** Traps are target-swapped REAL mentions (EV-A2): quote/t/seq verbatim,
 * only the target changes. The answer key is a separate return — recompute
 * from the seed at scoring time; NEVER persist it with the sample. */
export function seedTraps(mentions, { count, rng, swapPool }) {
	const evalSample = mentions.map((m) => ({ ...m }));
	for (let i = evalSample.length - 1; i > 0; i -= 1) {
		const j = Math.floor(rng() * (i + 1));
		[evalSample[i], evalSample[j]] = [evalSample[j], evalSample[i]];
	}
	const traps = [];
	const used = new Set();
	let guard = 0;
	while (traps.length < count && guard < evalSample.length * 4 + 16) {
		guard += 1;
		let idx = Math.floor(rng() * evalSample.length);
		while (used.has(idx)) idx = (idx + 1) % evalSample.length;
		const entry = evalSample[idx];
		const alternatives = swapPool.filter((id) => id !== entry.target);
		if (!alternatives.length) break;
		const swappedTarget = alternatives[Math.floor(rng() * alternatives.length)];
		traps.push({ index: idx, originalTarget: entry.target, swappedTarget });
		entry.target = swappedTarget;
		used.add(idx);
	}
	return { evalSample, answerKey: { traps } };
}

/** Deterministic under injected rng; cycles kinds so none is starved. */
export function stratifiedSample(mentions, { perEpisode, rng }) {
	const byKind = new Map();
	for (const m of mentions) {
		if (!byKind.has(m.kind)) byKind.set(m.kind, []);
		byKind.get(m.kind).push(m);
	}
	const kinds = [...byKind.keys()].sort();
	const pools = new Map(kinds.map((k) => [k, [...byKind.get(k)]]));
	const out = [];
	let ki = 0;
	while (out.length < perEpisode && kinds.some((k) => pools.get(k).length)) {
		const k = kinds[ki % kinds.length];
		ki += 1;
		const pool = pools.get(k);
		if (!pool.length) continue;
		out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
	}
	return out;
}

// ── agent-facing contracts ──────────────────────────────────────────────────

/** Structured-output contract for judgment agents. Numeric RANGES are
 * validated in code (validateMention) — schema can't express them. */
export function buildExtractionSchema() {
	return {
		type: 'object',
		additionalProperties: false,
		required: ['mentions'],
		properties: {
			mentions: {
				type: 'array',
				items: {
					type: 'object',
					additionalProperties: false,
					required: ['kind', 'target_hint', 'seq', 't', 'confidence', 'quote'],
					properties: {
						kind: { enum: ['verse', 'chapter', 'person', 'place', 'event', 'principle'] },
						target_hint: { type: 'string' },
						seq: { type: 'integer' },
						t: { type: 'number' },
						confidence: { type: 'number' },
						quote: { type: 'string' },
					},
				},
			},
		},
	};
}

export function buildChunkPrompt(chunk, { candidates, episodeTitle }) {
	const named = candidates.named.map((c) => `- ${c.id} (${c.name})`).join('\n');
	const principles = candidates.principles.map((c) => `- ${c.id} (${c.name})`).join('\n');
	return [
		`Episode: ${episodeTitle}`,
		`Chapter context: ${chunk.chapterContext.join(', ') || 'PRE-SEGMENT (refs here are flagged, not anchored)'}`,
		'',
		'Candidates present in this window:',
		named || '- (none)',
		'',
		'Principle pool (thematic — link only when the quote contains the teaching):',
		principles || '- (none)',
		'',
		'Transcript window:',
		...chunk.utterances.map(formatSeqLine),
	].join('\n');
}

export function buildTimelinePrompt({ episodeChapters, lines }) {
	return [
		'Verify the chapter timeline for this episode. The ONLY valid chapters',
		`are: ${episodeChapters.join(', ')}. Report corrections with the seq of`,
		'the utterance where each chapter is actually entered (announced OR',
		'inline forms like "in verse three of Second Kings 21").',
		'',
		...lines,
	].join('\n');
}
