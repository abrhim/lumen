// A2 extract stages (unshaken-extraction, Revision 1): extract-code runs the
// deterministic extractors and emits judgment briefs; extract-merge folds in
// validated judgment artifacts and emits the final extraction. NO API
// clients — AI enrichment happens in Claude Code workflows between the two
// stages, coupled only through artifacts.
import { readFileSync, existsSync, statSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { writeArtifactAtomic } from './util.mjs';
import { anchorsForBlock } from './parse-title.mjs';
import {
	chapterAt,
	detectChapterTransitions,
	parseSpokenVerseRefs,
	detectForeignWindows,
	aliasMatchCandidates,
	validateAliasTable,
	prefilterCandidates,
	resolveVerseRef,
	validateMention,
	verifyQuoteAtSeq,
	dedupeMentions,
	aggregateToEdges,
	formatSeqLine,
	spokenNumberToInt,
} from './extract-lib.mjs';
import { utterancesToRows } from './transcribe.mjs';

const CONFIDENCE = {
	chapter: 0.95,
	verseExplicit: 0.95,
	verseRange: 0.9,
	verseRelative: 0.8,
	entityName: 0.85,
	entityAlias: 0.75,
};
const RANGE_CAP = 40; // "verses 1 through 999" is a parse artifact, not a ref

const ORDINALS = { 1: 'First', 2: 'Second', 3: 'Third' };

export function pathsFor(ep, dir) {
	return {
		deepgram: join(dir, `${ep.id}.deepgram.json`),
		transcriptTxt: join(dir, `${ep.id}.transcript.txt`),
		extractionCode: join(dir, `${ep.id}.extraction-code.json`),
		judgmentBrief: join(dir, `${ep.id}.judgment-brief.json`),
		aliases: join(dir, `${ep.id}.aliases.json`),
		timelineReview: join(dir, `${ep.id}.timeline-review.json`),
		principles: (w) => join(dir, `${ep.id}.principles.${w}.json`),
		extraction: join(dir, `${ep.id}.extraction.json`),
	};
}

/** Spoken aliases per book: "2 Kings" also answers to "Second Kings". */
export function deriveBookMaps(bookRows, episodeChapters) {
	const blockBooks = new Set(episodeChapters.map((c) => c.replace(/-\d+$/, '')));
	const aliasesFor = (name) => {
		const out = [name];
		const m = name.match(/^([1-3]) (.+)$/);
		if (m) {
			out.push(`${ORDINALS[m[1]]} ${m[2]}`); // "Second Kings"
			out.push(`${m[1]}${['st', 'nd', 'rd'][m[1] - 1]} ${m[2]}`); // "2nd Kings" (ASR)
		}
		return out;
	};
	const bookAliases = {};
	const foreignBooks = {};
	for (const b of bookRows) {
		for (const alias of aliasesFor(b.name)) {
			if (blockBooks.has(b.id)) bookAliases[alias] = b.id;
			else foreignBooks[alias] = b.id;
		}
	}
	return { bookAliases, foreignBooks };
}

/** Per-episode candidate pool: entities on verse-level edges + summary
 * FEATURES within the block (A1 plan probe 7's recorded correction). */
export async function fetchCandidatePool(sql, episodeChapters) {
	const patterns = episodeChapters.map((c) => `${c}-%`);
	const rows = await sql`
		WITH touching AS (
			SELECT CASE WHEN ed.to_id LIKE ANY(${patterns}) THEN ed.from_id ELSE ed.to_id END AS other_id
			FROM lumen.edges ed
			WHERE ed.to_id LIKE ANY(${patterns}) OR ed.from_id LIKE ANY(${patterns})
		)
		SELECT DISTINCT ent.id, ent.name, ent.entity_type
		FROM touching t JOIN lumen.entities ent ON ent.id = t.other_id
		WHERE ent.entity_type IN ('person','place','event','principle','symbol')`;
	const pool = { person: [], place: [], event: [], principle: [], symbol: [] };
	for (const r of rows) pool[r.entity_type].push({ id: r.id, name: r.name });
	return pool;
}

function inForeignWindow(t, windows) {
	return windows.some((w) => t >= w.tStart && t <= w.tEnd);
}

function quoteFrom(u) {
	return u.text.split(/\s+/).slice(0, 25).join(' ');
}

export function contentHash(value) {
	return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

/** The deterministic pass. Pure given its inputs — extract-merge re-runs it
 * with judgment-corrected timeline/aliases, so keep it side-effect free. */
export function runDeterministicExtraction(utterances, ctx) {
	const {
		episodeId,
		episodeChapters,
		bookAliases,
		foreignBooks,
		pool,
		aliasTable = [],
		timelineOverride = null,
	} = ctx;

	const timeline = timelineOverride ?? detectChapterTransitions(utterances, { episodeChapters, bookAliases });
	const foreignWindows = detectForeignWindows(utterances, { foreignBooks });
	const verseExists = ctx.verseExists;

	const mentions = [];
	const drops = [];
	const counts = {
		foreignDropped: 0,
		preSegmentDropped: 0,
		relativeUnresolved: 0,
		resolutionFailures: {},
	};

	// chapter mentions from the timeline itself (seq recorded at detection —
	// float-equality lookups against t are a trap). Agent-reviewed timelines
	// carry no evidence text — fall back to the utterance at seq so gold
	// selection (eval) has real quotes to work with.
	const bySeq = new Map(utterances.map((u) => [u.seq, u]));
	for (const seg of timeline) {
		const seq = seg.seq ?? utterances.find((x) => x.t_start_s === seg.t_start_s)?.seq ?? 0;
		mentions.push({
			kind: 'chapter',
			target: seg.chapter,
			seq,
			t: seg.t_start_s,
			confidence: CONFIDENCE.chapter,
			quote: quoteFrom({ text: seg.evidence ?? bySeq.get(seq)?.text ?? '' }),
		});
	}

	const firstSegT = timeline.length ? Math.min(...timeline.map((s) => s.t_start_s)) : Infinity;
	let lastVerse = null;
	let lastVerseChapter = null;

	for (const u of utterances) {
		const refs = parseSpokenVerseRefs(u.text);
		if (!refs.length) continue;
		if (inForeignWindow(u.t_start_s, foreignWindows)) {
			counts.foreignDropped += refs.length;
			continue;
		}
		// out-of-block "chapter N" in the SAME utterance = a context break the
		// window detector missed ("…in chapter 28 verse nine and ten" during a
		// 2 Chr tangent) — wrong-but-existing anchors. Fail closed + census.
		const contextBreak = [...u.text.matchAll(/\bchapter\s+(\d{1,3}|[a-z]+(?:[ -][a-z]+)?)\b/gi)].some(
			(m) => {
				const n = spokenNumberToInt(m[1]);
				return Number.isInteger(n) && !episodeChapters.some((c) => c.endsWith(`-${n}`));
			},
		);
		if (contextBreak) {
			counts.contextBreakDropped = (counts.contextBreakDropped ?? 0) + refs.length;
			continue;
		}
		if (u.t_start_s < firstSegT) {
			counts.preSegmentDropped += refs.length;
			continue;
		}
		const governing = chapterAt(timeline, u.t_start_s);
		if (!governing) continue;
		if (governing !== lastVerseChapter) {
			lastVerse = null;
			lastVerseChapter = governing;
		}
		for (const ref of refs) {
			let nums = [];
			let conf = CONFIDENCE.verseExplicit;
			if (ref.relative !== undefined) {
				if (lastVerse === null) {
					counts.relativeUnresolved += 1;
					continue;
				}
				nums = [lastVerse + ref.relative];
				conf = CONFIDENCE.verseRelative;
			} else if (ref.verseEnd !== undefined) {
				if (ref.verseEnd - ref.verse > RANGE_CAP) {
					drops.push({ seq: u.seq, reason: `range too wide: ${ref.verse}-${ref.verseEnd}` });
					continue;
				}
				for (let v = ref.verse; v <= ref.verseEnd; v += 1) nums.push(v);
				conf = CONFIDENCE.verseRange;
			} else {
				nums = [ref.verse];
			}
			for (const verse_num of nums) {
				const r = resolveVerseRef({ chapter_ctx: governing, verse_num }, { episodeChapters, verseExists });
				if (r.id === null) {
					drops.push({ seq: u.seq, reason: r.reason });
					counts.resolutionFailures[governing] = (counts.resolutionFailures[governing] ?? 0) + 1;
					continue;
				}
				mentions.push({
					kind: 'verse',
					target: r.id,
					seq: u.seq,
					t: u.t_start_s,
					confidence: conf,
					quote: quoteFrom(u),
				});
				lastVerse = verse_num;
			}
		}
	}

	// entity mentions: pool names + validated agent aliases. Round-1 eval
	// verdicts drove four deterministic guards (entity stratum 0.667 → the
	// error classes were ALL mechanical):
	// (1) collision routing on the BASE pool — naaman-1 vs naaman-2 share a
	//     name; matching either is a coin flip, so ambiguous names are
	//     excluded and surfaced in coverage (EV-A10 extended to base names);
	// (2) common-word guard — pool has persons named "So" and "On"; any name
	//     token that also appears lowercase in THIS transcript is running
	//     English, not a proper-noun hit ("wilderness" too);
	const lowerTokens = new Set();
	for (const u of utterances) {
		for (const m of u.text.matchAll(/(?<=[a-z] )([a-z]{2,})\b/g)) lowerTokens.add(m[1]);
	}
	const nameClaims = new Map();
	for (const kind of ['person', 'place', 'event']) {
		for (const e of pool[kind]) {
			const k = e.name.toLowerCase();
			if (!nameClaims.has(k)) nameClaims.set(k, []);
			nameClaims.get(k).push(e.id);
		}
	}
	const ambiguousNames = new Set([...nameClaims.entries()].filter(([, ids]) => ids.length > 1).map(([k]) => k));
	counts.ambiguousNamesExcluded = [...ambiguousNames];
	const commonWordName = (name) => name.split(/\s+/).every((w) => lowerTokens.has(w.toLowerCase()));
	const baseTable = [
		...['person', 'place', 'event'].flatMap((kind) =>
			pool[kind]
				.filter((e) => !ambiguousNames.has(e.name.toLowerCase()) && !commonWordName(e.name))
				.map((e) => ({ id: e.id, names: [e.name], kind, base: true })),
		),
		...aliasTable.map((row) => ({ ...row, base: false })),
	];
	const kindById = new Map();
	for (const kind of ['person', 'place', 'event', 'principle', 'symbol']) {
		for (const e of pool[kind]) kindById.set(e.id, kind);
	}
	// (3) book-citation guard — "first Samuel chapter eight" is a citation,
	//     not Samuel-the-person; (4) formula guard — "law of Moses" in a Ruth
	//     episode is a formula, not a Moses mention.
	const citationRe = (name) =>
		new RegExp(
			`(?:\\b(?:first|second|third|1st|2nd|3rd)\\s+${name}\\b|\\b${name}\\s+(?:chapter|section)\\b|\\b${name}\\s+\\d|\\b(?:law|book|books)\\s+of\\s+${name}\\b)`,
			'i',
		);
	for (const u of utterances) {
		for (const hit of aliasMatchCandidates(u.text, baseTable)) {
			const kind = kindById.get(hit.id);
			if (!kind || kind === 'principle' || kind === 'symbol') continue;
			const matchedName = hit.names.find((n) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(u.text)) ?? hit.names[0];
			if (citationRe(matchedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(u.text)) {
				counts.citationSuppressed = (counts.citationSuppressed ?? 0) + 1;
				continue;
			}
			mentions.push({
				kind,
				target: hit.id,
				seq: u.seq,
				t: u.t_start_s,
				confidence: hit.base ? CONFIDENCE.entityName : CONFIDENCE.entityAlias,
				quote: quoteFrom(u),
			});
		}
	}

	return { timeline, foreignWindows, mentions, drops, counts };
}

/** Coverage block (EV-A7): novelty surfaces at RUN time, not eval time. */
export function buildCoverageBlock(utterances, result, ctx) {
	const { episodeChapters, bookAliases, foreignBooks, pool } = ctx;
	const covered = new Set(result.timeline.map((s) => s.chapter));
	const zeroSegmentChapters = episodeChapters.filter((c) => !covered.has(c));
	const knownHeads = new Set(
		[...Object.keys(bookAliases), ...Object.keys(foreignBooks)].map((a) => a.toLowerCase()),
	);
	const CONTAINER_NOUNS = new Set(['verse', 'verses', 'chapter', 'chapters', 'section', 'sections', 'psalm', 'page']);
	const headCounts = new Map();
	let relativeRefs = 0;
	for (const u of utterances) {
		for (const m of u.text.matchAll(/\b([A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?)\s+\d{1,3}\b/g)) {
			const head = m[1];
			if (knownHeads.has(head.toLowerCase()) || CONTAINER_NOUNS.has(head.toLowerCase())) continue;
			headCounts.set(head, (headCounts.get(head) ?? 0) + 1);
		}
		if (/\b(?:next|following|last|final|first|second)\s+verse\b/i.test(u.text)) relativeRefs += 1;
	}
	const inWindows = utterances.filter((u) => inForeignWindow(u.t_start_s, result.foreignWindows)).length;
	const matchedIds = new Set(result.mentions.map((m) => m.target));
	const zeroHitPoolNames = ['person', 'place', 'event']
		.flatMap((k) => pool[k])
		.filter((e) => !matchedIds.has(e.id))
		.map((e) => ({ id: e.id, name: e.name }));
	// unknown capitalized tokens (alias candidates for the census). A word
	// that ALSO appears lowercase is running prose (That/Well/They), not a
	// proper noun — real names never decapitalize.
	const tokenCounts = new Map();
	const lowerCounts = new Map();
	for (const u of utterances) {
		for (const m of u.text.matchAll(/\b([A-Z][a-z]{3,})\b/g)) {
			tokenCounts.set(m[1], (tokenCounts.get(m[1]) ?? 0) + 1);
		}
		for (const m of u.text.matchAll(/\b([a-z]{4,})\b/g)) {
			lowerCounts.set(m[1], (lowerCounts.get(m[1]) ?? 0) + 1);
		}
	}
	const poolNameTokens = new Set(
		['person', 'place', 'event'].flatMap((k) => pool[k].flatMap((e) => e.name.toLowerCase().split(/\s+/))),
	);
	const unknownTokens = [...tokenCounts.entries()]
		.filter(
			([tok, n]) =>
				n >= 3 &&
				!poolNameTokens.has(tok.toLowerCase()) &&
				!knownHeads.has(tok.toLowerCase()) &&
				!lowerCounts.has(tok.toLowerCase()),
		)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 80)
		.map(([token, n]) => ({ token, n }));

	return {
		zeroSegmentChapters,
		unmatchedBookHeads: [...headCounts.entries()].map(([head, n]) => ({ head, n })),
		relativeRefUtterances: relativeRefs,
		pctUtterancesInForeignWindows: utterances.length ? +(100 * inWindows / utterances.length).toFixed(1) : 0,
		foreignWindowAlarm: utterances.length ? inWindows / utterances.length > 0.15 : false,
		preSegmentDropped: result.counts.preSegmentDropped,
		foreignDropped: result.counts.foreignDropped,
		relativeUnresolved: result.counts.relativeUnresolved,
		resolutionFailureClusters: result.counts.resolutionFailures,
		zeroHitPoolNames,
		unknownTokens,
	};
}

export function isValidCodeArtifact(path, epId) {
	if (!existsSync(path)) return false;
	try {
		const a = JSON.parse(readFileSync(path, 'utf8'));
		return a.episodeId === epId && Array.isArray(a.mentions) && a.fingerprint?.utteranceCount > 0;
	} catch {
		return false;
	}
}

export async function runExtractCode(sql, ep, dir, lookup, opts, log) {
	const paths = pathsFor(ep, dir);
	const episodeId = `${opts.showId}-${ep.id}`;
	if (!opts.refresh && isValidCodeArtifact(paths.extractionCode, episodeId)) {
		log('extract_code_cached', { episode: ep.id });
		return JSON.parse(readFileSync(paths.extractionCode, 'utf8'));
	}
	const dg = JSON.parse(readFileSync(paths.deepgram, 'utf8'));
	const utterances = utterancesToRows(dg, episodeId);
	const episodeChapters = anchorsForBlock(ep.spans, lookup);
	const { bookAliases, foreignBooks } = deriveBookMaps(opts.bookRows, episodeChapters);
	const pool = await fetchCandidatePool(sql, episodeChapters);
	const verseSet = new Set(
		(await sql`SELECT id FROM lumen.verses WHERE chapter_id = ANY(${episodeChapters})`).map((r) => r.id),
	);
	const ctx = {
		episodeId,
		episodeChapters,
		bookAliases,
		foreignBooks,
		pool,
		verseExists: (id) => verseSet.has(id),
	};
	const result = runDeterministicExtraction(utterances, ctx);
	const coverage = buildCoverageBlock(utterances, result, ctx);
	const fingerprint = {
		utteranceCount: utterances.length,
		durationS: Number(dg?.metadata?.duration ?? 0),
	};

	// rendered transcript for judgment/eval agents (deepgram.json is 10MB;
	// agents Read seq-lines with offset/limit instead)
	writeArtifactAtomic(paths.transcriptTxt, utterances.map(formatSeqLine).join('\n'), {
		writeFileSync,
		renameSync,
	});
	const codeArtifact = {
		episodeId,
		fingerprint,
		timeline: result.timeline,
		foreignWindows: result.foreignWindows,
		mentions: result.mentions,
		drops: result.drops.slice(0, 500),
		counts: result.counts,
	};
	writeArtifactAtomic(paths.extractionCode, JSON.stringify(codeArtifact, null, 1), {
		writeFileSync,
		renameSync,
	});
	writeArtifactAtomic(
		paths.judgmentBrief,
		JSON.stringify({
			episodeId,
			title: ep.title,
			blockChapters: episodeChapters,
			fingerprint,
			transcriptPath: paths.transcriptTxt,
			timeline: result.timeline,
			coverage,
			principlePool: pool.principle,
			aliasCandidates: {
				zeroHitPoolNames: coverage.zeroHitPoolNames,
				unknownTokens: coverage.unknownTokens,
			},
		}, null, 1),
		{ writeFileSync, renameSync },
	);
	log('extract_code_done', {
		episode: ep.id,
		segments: result.timeline.length,
		mentions: result.mentions.length,
		drops: result.drops.length,
		zero_segment_chapters: coverage.zeroSegmentChapters.length,
		foreign_pct: coverage.pctUtterancesInForeignWindows,
	});
	return codeArtifact;
}

function readJudgment(paths, log, epId) {
	const out = { aliases: [], timeline: null, principles: [], missing: [] };
	if (existsSync(paths.aliases)) {
		try {
			out.aliases = JSON.parse(readFileSync(paths.aliases, 'utf8')).aliases ?? [];
		} catch {
			out.missing.push('aliases(unparseable)');
		}
	} else out.missing.push('aliases');
	if (existsSync(paths.timelineReview)) {
		try {
			const tr = JSON.parse(readFileSync(paths.timelineReview, 'utf8'));
			if (Array.isArray(tr.timeline) && tr.timeline.length) out.timeline = tr.timeline;
		} catch {
			out.missing.push('timeline-review(unparseable)');
		}
	} else out.missing.push('timeline-review');
	for (const w of [0, 1]) {
		const p = paths.principles(w);
		if (existsSync(p)) {
			try {
				out.principles.push(...(JSON.parse(readFileSync(p, 'utf8')).mentions ?? []));
			} catch {
				out.missing.push(`principles.${w}(unparseable)`);
			}
		} else out.missing.push(`principles.${w}`);
	}
	if (out.missing.length) log('judgment_incomplete', { episode: epId, missing: out.missing });
	return out;
}

export async function runExtractMerge(sql, ep, dir, lookup, opts, log) {
	const paths = pathsFor(ep, dir);
	const episodeId = `${opts.showId}-${ep.id}`;
	if (!isValidCodeArtifact(paths.extractionCode, episodeId)) {
		throw new Error(`${ep.id}: extraction-code artifact missing/invalid — run --stage=extract-code first`);
	}
	const codeArtifact = JSON.parse(readFileSync(paths.extractionCode, 'utf8'));
	const dg = JSON.parse(readFileSync(paths.deepgram, 'utf8'));
	const utterances = utterancesToRows(dg, episodeId);
	// PW-A6: upstream fingerprint must match — a --refresh re-transcription
	// shifts every seq/t and silently invalidates cached extraction.
	if (utterances.length !== codeArtifact.fingerprint.utteranceCount) {
		throw new Error(
			`${ep.id}: transcript fingerprint mismatch (${utterances.length} vs ${codeArtifact.fingerprint.utteranceCount}) — re-run extract-code`,
		);
	}
	const episodeChapters = anchorsForBlock(ep.spans, lookup);
	const { bookAliases, foreignBooks } = deriveBookMaps(opts.bookRows, episodeChapters);
	const pool = await fetchCandidatePool(sql, episodeChapters);
	const verseSet = new Set(
		(await sql`SELECT id FROM lumen.verses WHERE chapter_id = ANY(${episodeChapters})`).map((r) => r.id),
	);

	const judgment = readJudgment(paths, log, ep.id);

	// EV-A10: agent alias tables are validated deterministically — census
	// membership, pool membership, collisions routed (dropped in v1 + logged)
	const censusTokens = new Set();
	for (const u of utterances) for (const m of u.text.matchAll(/\b([A-Za-z][a-z]{1,})\b/g)) censusTokens.add(m[1].toLowerCase());
	const poolIds = new Set(['person', 'place', 'event'].flatMap((k) => pool[k].map((e) => e.id)));
	const aliasCheck = validateAliasTable(judgment.aliases, { censusTokens, poolIds });
	if (aliasCheck.rejected.length || aliasCheck.collisions.length) {
		log('alias_validation', {
			episode: ep.id,
			valid: aliasCheck.valid.length,
			rejected: aliasCheck.rejected.length,
			collisions: aliasCheck.collisions.map((c) => c.token),
		});
	}

	const ctx = {
		episodeId,
		episodeChapters,
		bookAliases,
		foreignBooks,
		pool,
		aliasTable: aliasCheck.valid,
		timelineOverride: judgment.timeline,
		verseExists: (id) => verseSet.has(id),
	};
	const result = runDeterministicExtraction(utterances, ctx);

	// principles from judgment agents: closed vocab + floor + quote-at-seq
	const principleIds = new Set(pool.principle.map((e) => e.id));
	const principleDrops = [];
	for (const m of judgment.principles) {
		const mention = {
			kind: 'principle',
			target: m.target,
			seq: m.seq,
			t: utterances.find((u) => u.seq === m.seq)?.t_start_s ?? -1,
			confidence: m.confidence,
			quote: m.quote,
		};
		const v = validateMention(mention, { poolIds: principleIds });
		if (!v.ok) {
			principleDrops.push({ seq: m.seq, reason: v.reason });
			continue;
		}
		const q = verifyQuoteAtSeq(mention, { utterances });
		if (!q.ok) {
			principleDrops.push({ seq: m.seq, reason: q.reason });
			continue;
		}
		if (mention.t < 0) {
			principleDrops.push({ seq: m.seq, reason: `no utterance at seq ${m.seq}` });
			continue;
		}
		result.mentions.push(mention);
	}

	const deduped = dedupeMentions(result.mentions);
	const edges = aggregateToEdges(deduped, { episodeId });
	const extraction = {
		episodeId,
		fingerprint: codeArtifact.fingerprint,
		judgmentComplete: judgment.missing.length === 0,
		judgmentMissing: judgment.missing,
		aliasValidation: {
			valid: aliasCheck.valid.length,
			rejected: aliasCheck.rejected.length,
			collisions: aliasCheck.collisions.map((c) => c.token),
		},
		principleDrops: principleDrops.slice(0, 200),
		mentions: deduped,
		edges,
	};
	extraction.contentHash = contentHash({ episodeId, mentions: deduped, edges });
	writeArtifactAtomic(paths.extraction, JSON.stringify(extraction, null, 1), {
		writeFileSync,
		renameSync,
	});
	log('extract_merge_done', {
		episode: ep.id,
		mentions: deduped.length,
		edges: edges.length,
		principles_kept: edges.filter((e) => e.relType === 'TEACHES').length,
		principle_drops: principleDrops.length,
		judgment_complete: extraction.judgmentComplete,
	});
	return extraction;
}
