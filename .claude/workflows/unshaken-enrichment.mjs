export const meta = {
	name: 'unshaken-enrichment',
	description: 'AI-enrichment judgment for unshaken episodes — alias-map, timeline-review, principles; subagents only, artifacts on disk',
	whenToUse: 'After --stage=extract-code and before --stage=extract-merge; args: {episodes: ["<videoId>", ...]}',
	phases: [
		{ title: 'Enrich', detail: 'per episode: alias-map + timeline-review + 2 principle windows, in parallel' },
	],
}

// Revision 1 (Abram, verbatim): "you are to exclusively use the claude code
// workflows nad sub agents to run ai enrichment." Each agent writes its own
// artifact (EV-A12: file-based resume — skip-if-valid at extract-merge);
// structured returns let the workflow validate shape early. Agents receive
// brief + transcript paths ONLY — never plan/review docs (EV-A3 hygiene).

const DIR = 'data/podcasts/unshaken'
const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
const episodes = parsedArgs?.episodes
if (!Array.isArray(episodes) || episodes.length === 0) {
	throw new Error('args.episodes required: ["<videoId>", ...]')
}

const ALIAS_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['aliases'],
	properties: {
		aliases: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false, required: ['id', 'names'],
				properties: {
					id: { type: 'string' },
					names: { type: 'array', items: { type: 'string' } },
				},
			},
		},
	},
}

const TIMELINE_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['timeline', 'notes'],
	properties: {
		timeline: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false, required: ['chapter', 'seq', 't_start_s'],
				properties: {
					chapter: { type: 'string' },
					seq: { type: 'integer' },
					t_start_s: { type: 'number' },
				},
			},
		},
		notes: { type: 'string' },
	},
}

const PRINCIPLES_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['mentions'],
	properties: {
		mentions: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false, required: ['target', 'seq', 'confidence', 'quote'],
				properties: {
					target: { type: 'string' },
					seq: { type: 'integer' },
					confidence: { type: 'number' },
					quote: { type: 'string' },
				},
			},
		},
	},
}

const shared = (ep, outPath) => `RESUME CHECK FIRST (EV-A12 file-based resume): if ${outPath} already
exists, Read it; if it parses as JSON with the required output shape,
return its contents as your structured output WITHOUT re-analyzing, and do
not rewrite the file. Otherwise proceed:

Work ONLY from these two files (do not read anything else in the repo —
no plan docs, no review docs, no other artifacts):
- Brief: ${DIR}/${ep}.judgment-brief.json
- Transcript: ${DIR}/${ep}.transcript.txt (line N = seq N−1; every line is
  "[seq @ h:mm:ss] text" — cite the seq inside the brackets, and Read with
  offset/limit to move through it in slices)`

const aliasPrompt = (ep) => `${shared(ep, `${DIR}/${ep}.aliases.json`)}

You are the ALIAS-MAP judge for this podcast episode. Deepgram's ASR spells
biblical names phonetically ("Ahas" for Ahaz, "Jehoiachim" for Jehoiakim).
The brief's aliasCandidates block gives you (a) unknownTokens — frequent
capitalized tokens that matched nothing, with counts — and (b)
zeroHitPoolNames — pool entities whose canonical name never matched.

Map ASR variants to pool entity ids. Rules:
- Every alias you emit MUST be a verbatim token from unknownTokens (code
  validates against the census and silently drops anything else).
- Every id MUST come from the brief's pools (zeroHitPoolNames ids or
  principle-pool-adjacent entity ids named in the brief). Never invent ids.
- Only map when confident from CONTEXT: Read the transcript around a few
  occurrences (grep-like scan by Reading slices) and confirm the narrative
  fits that entity. "Assyrians" is a people, not the person "Assyria" —
  skip collectives unless the pool has a matching entity.
- If one token could be two different pool entities, DO NOT pick — omit it
  (code routes collisions to review; first-wins poisons everything).

Write EXACTLY this JSON to ${DIR}/${ep}.aliases.json using the Write tool:
{"aliases": [{"id": "<pool id>", "names": ["<VariantToken>", ...]}, ...]}
Then return the same object as your structured output.`

const timelinePrompt = (ep) => `${shared(ep, `${DIR}/${ep}.timeline-review.json`)}

You are the TIMELINE-REVIEW judge. The brief's "timeline" is a code-detected
list of chapter segments {chapter, seq, t_start_s}; "coverage" lists
zeroSegmentChapters (block chapters with NO segment — the main thing to fix)
and blockChapters (the ONLY valid chapters).

Verify and correct:
1. For each zeroSegmentChapter, scan the transcript for where it is actually
   entered. Chapters enter in sneaky forms: "Now 24" right after chapter 23
   ends, "in verse three of 2nd Kings 21", "moving to the next chapter".
2. Check detected segments for false transitions (a flashback like "back in
   chapter 19" is NOT a re-entry unless discussion actually moves there for
   multiple utterances — if it does move, it IS a segment).
3. Segments must be in ascending t_start_s order; chapter values must be
   from blockChapters verbatim; seq/t_start_s must come from the actual
   transcript line where the chapter is entered.

Return the FULL corrected timeline (it replaces the detected one wholesale)
plus one-paragraph notes on what you changed and why. Write EXACTLY
{"timeline": [...], "notes": "..."} to ${DIR}/${ep}.timeline-review.json
using the Write tool, then return the same object as structured output.`

const principlesPrompt = (ep, w) => `${shared(ep, `${DIR}/${ep}.principles.${w}.json`)}

You are PRINCIPLES judge, window ${w} of 2. The brief's fingerprint gives
utteranceCount N; your window is seq ${w === 0 ? '0 to floor(N/2)-1' : 'floor(N/2) to N-1'}.
Read your window of the transcript in slices. The brief's principlePool
lists the ONLY principles you may link ({id, name}).

Emit a TEACHES mention when the speaker actually TEACHES a principle in your
window — the quote must CONTAIN THE TEACHING, not merely the topic word
("trust the Lord even when the siege comes" teaches Faith; "he mentioned
faith" does not). Rules:
- target: a principlePool id, verbatim. Never invent.
- seq: the utterance where the teaching quote lives (the [seq @ …] number).
- quote: VERBATIM text from that utterance (code rejects quotes that do not
  appear at seq±1 — paraphrase = automatic drop).
- confidence: honest 0.5–1.0 (below 0.5 is dropped; do not inflate).
- Quality over quantity: a 3.5-hour episode teaches maybe 10–25 clear
  principle moments per half. Cap yourself at 30.

Write EXACTLY {"mentions": [...]} to ${DIR}/${ep}.principles.${w}.json using
the Write tool, then return the same object as structured output.`

phase('Enrich')
log(`enriching ${episodes.length} episode(s) — 4 agents each`)

const results = await pipeline(
	episodes,
	(ep) =>
		parallel([
			() => agent(aliasPrompt(ep), { label: `alias:${ep}`, phase: 'Enrich', schema: ALIAS_SCHEMA, effort: 'medium' }),
			() => agent(timelinePrompt(ep), { label: `timeline:${ep}`, phase: 'Enrich', schema: TIMELINE_SCHEMA, effort: 'high' }),
			() => agent(principlesPrompt(ep, 0), { label: `principles0:${ep}`, phase: 'Enrich', schema: PRINCIPLES_SCHEMA, effort: 'medium' }),
			() => agent(principlesPrompt(ep, 1), { label: `principles1:${ep}`, phase: 'Enrich', schema: PRINCIPLES_SCHEMA, effort: 'medium' }),
		]).then(([aliases, timeline, p0, p1]) => ({
			episode: ep,
			aliases: aliases?.aliases?.length ?? null,
			timelineSegments: timeline?.timeline?.length ?? null,
			principles: (p0?.mentions?.length ?? 0) + (p1?.mentions?.length ?? 0),
			agentFailures: [aliases, timeline, p0, p1].filter((x) => x === null).length,
		})),
)

const flat = results.filter(Boolean)
const failures = flat.filter((r) => r.agentFailures > 0)
log(`enrichment done: ${flat.length}/${episodes.length} episodes, ${failures.length} with agent failures`)
return { episodes: flat, failures: failures.map((f) => f.episode) }
