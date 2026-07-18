export const meta = {
	name: 'unshaken-code-review',
	description: 'Code panel + adversarial verification for the unshaken-extraction branch — find everything, then try to kill every finding',
	whenToUse: 'Steps 9–10 of the feature workflow, after implementation is complete. args: {slug: "unshaken-extraction"}',
	phases: [
		{ title: 'Find', detail: '4 dimension reviewers over the branch diff — coverage-first' },
		{ title: 'Verify', detail: '2 adversarial refuters per finding, majority kills' },
	],
}

const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
const slug = parsedArgs?.slug ?? 'unshaken-extraction'
const REVIEW_DIR = `docs/features/${slug}/reviews`

const FINDINGS_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['findings'],
	properties: {
		findings: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false,
				required: ['title', 'severity', 'file', 'claim', 'evidence'],
				properties: {
					title: { type: 'string' },
					severity: { enum: ['high', 'med', 'low'] },
					file: { type: 'string' },
					line: { type: 'integer' },
					claim: { type: 'string' },
					evidence: { type: 'string' },
				},
			},
		},
	},
}

const VERDICT_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['refuted', 'reasoning', 'tag'],
	properties: {
		refuted: { type: 'boolean' },
		reasoning: { type: 'string' },
		tag: { enum: ['material', 'risky', 'noise', 'oos'] },
	},
}

const DIMENSIONS = [
	{
		key: 'data-integrity',
		brief: `Correctness of every write path this branch adds or edits: the A2
load plan/executor (scripts/ingest-podcast/load-extraction.mjs), the A1
co-fixes in load.mjs + index.mjs executor, repair-metadata-encoding.mjs.
Trace re-run sequences (A2 twice; A1 then A2 then A1), tx boundaries,
rowCount asserts, ON CONFLICT arbitration on the partial unique index,
jsonb serialization (raw objects — never pre-stringified). Compare against
the contracts pinned in scripts/__tests__/ingest-extraction.test.mjs and
plan.md §Design — divergence between code and pinned contract IS a finding.`,
	},
	{
		key: 'extraction-correctness',
		brief: `The deterministic extractors and merge pipeline:
scripts/ingest-podcast/extract-lib.mjs + extract.mjs. Ref parsing edge
cases (ranges, elisions, relatives), timeline stamping, foreign windows,
the four round-1 entity guards (collision routing, common-word,
book-citation, formula), quote-at-seq verification, dedupe/aggregation,
confidence flow, fingerprint checks. Off-by-ones, regex escapes, NaN paths,
unhandled shapes from agent-produced judgment artifacts (they are UNTRUSTED
input — what happens on malformed JSON, wrong types, hostile strings?).`,
	},
	{
		key: 'eval-integrity',
		brief: `The eval machinery: scripts/extraction-eval.mjs + the two
workflow files in .claude/workflows/ + docs/features/${slug}/eval-prompt.md.
Determinism of deriveRound (same inputs → same key at --build and --score
— any Math.random/Date/iteration-order hazard breaks key recomputation),
trap indistinguishability in written packets, seed derivation, Wilson math,
gate-rule implementation vs plan.md §Eval, stale-eval detection, shard/
duplicate mechanics. An eval that can silently grade wrong is a HIGH.`,
	},
	{
		key: 'reliability-secrets',
		brief: `Operational reliability + secrets across the branch: runner
wiring in index.mjs (stage prereqs, exit codes, rollups, eval-verdict
gate), artifact validity predicates + skip-if-valid + atomic writes,
smoke-extraction.mjs + smoke-media.mjs invariant SQL correctness, DSN
scrubbing on every new error path, log hygiene (no secrets in artifacts/
logs), crash-mid-stage recovery for every new stage.`,
	},
]

const findPrompt = (d) => `You are the ${d.key} reviewer for the lumen repo feature branch
feature/unshaken-extraction (repo root: current directory).

Scope: ${d.brief}

Method: run \`git diff main...HEAD --stat\` then read the changed files in
your scope IN FULL (not just hunks — context bugs hide outside the diff).
docs/features/${slug}/plan.md §Design/§Eval is the contract; the harness
(scripts/__tests__/ingest-extraction.test.mjs) is the pinned behavior.

Report EVERY issue you find, including ones you are uncertain about or
consider low-severity. Do not filter for importance or confidence — a
separate adversarial verification step does that. Coverage over precision:
better to surface a finding that gets killed than to silently drop a bug.
For each: title, severity (high/med/low), file, line if known, the claim
(one precise sentence), and evidence (quote the code).

Write your full review to ${REVIEW_DIR}/code-panel/${d.key}.md (## Findings
with ### F<n> sections, then ## Verdict), then return the findings as
structured output.`

const verifyPrompt = (f, lens) => `You are an adversarial verifier (${lens} lens) for a code-review
finding on the lumen repo branch feature/unshaken-extraction. PRESUME THE
FINDING IS WRONG and try to kill it.

Finding: "${f.title}" (severity ${f.severity})
File: ${f.file}${f.line ? `:${f.line}` : ''}
Claim: ${f.claim}
Evidence offered: ${f.evidence}

Read the actual code in full context. ${lens === 'exploit' ? 'Attempt to construct the CONCRETE failing input/sequence the claim implies — if you cannot construct one, the finding is refuted.' : 'Check whether an existing test, guard, validity predicate, or upstream invariant already prevents the claimed failure — cite the exact line if so.'}

Return: refuted (true = the finding dies), reasoning (concrete — cite code
lines or the failing sequence you built), and tag: material (real, must
fix) / risky (real but needs a decided default, not a code fix) / noise
(pedantic or wrong) / oos (real but belongs to another feature).`

phase('Find')
const found = await parallel(
	DIMENSIONS.map((d) => () =>
		agent(findPrompt(d), { label: `find:${d.key}`, phase: 'Find', schema: FINDINGS_SCHEMA, effort: 'high' })),
)
const findings = found
	.filter(Boolean)
	.flatMap((r, di) => r.findings.map((f) => ({ ...f, dimension: DIMENSIONS[di].key })))
// dedupe by (file, title-ish)
const seen = new Set()
const deduped = findings.filter((f) => {
	const k = `${f.file}|${f.title.toLowerCase().slice(0, 40)}`
	if (seen.has(k)) return false
	seen.add(k)
	return true
})
log(`found ${findings.length} findings (${deduped.length} after dedupe) — verifying`)

phase('Verify')
const verified = await parallel(
	deduped.map((f, i) => () =>
		parallel([
			() => agent(verifyPrompt(f, 'exploit'), { label: `verify${i}:exploit`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' }),
			() => agent(verifyPrompt(f, 'guard'), { label: `verify${i}:guard`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'high' }),
		]).then((vs) => {
			const live = vs.filter(Boolean)
			const survives = live.length > 0 && live.filter((v) => !v.refuted).length >= Math.ceil(live.length / 2)
			const tags = live.map((v) => v.tag)
			return { ...f, survives, tags, verifierReasoning: live.map((v) => v.reasoning) }
		})),
)
const confirmed = verified.filter(Boolean).filter((v) => v.survives)
log(`confirmed ${confirmed.length}/${deduped.length} findings`)
return {
	total: findings.length,
	deduped: deduped.length,
	confirmed: confirmed.map((c) => ({
		title: c.title, severity: c.severity, file: c.file, line: c.line ?? null,
		dimension: c.dimension, tags: c.tags, claim: c.claim,
	})),
	killed: verified.filter(Boolean).filter((v) => !v.survives).map((v) => ({ title: v.title, file: v.file })),
}
