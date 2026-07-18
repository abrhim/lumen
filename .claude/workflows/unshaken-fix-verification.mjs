export const meta = {
	name: 'unshaken-fix-verification',
	description: 'Fix-verification pass — fresh agents re-examine each review fix for residuals and fix-induced regressions',
	whenToUse: 'After the fix round commits, before retro/merge. args: {slug}',
	phases: [{ title: 'Verify fixes', detail: 'file-cluster shards, residual + regression hunting' }],
}

// House pattern (2-for-2 across features): green suites + applied fixes
// still hide residuals. Fresh-context agents per file cluster verify each
// fix ACTUALLY closes its finding, then hunt regressions the fix introduced.

const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
const slug = parsedArgs?.slug ?? 'unshaken-extraction'

const RESIDUALS_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['verified', 'residuals'],
	properties: {
		verified: { type: 'array', items: { type: 'string' } },
		residuals: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false,
				required: ['id', 'severity', 'file', 'claim', 'evidence'],
				properties: {
					id: { type: 'string' },
					severity: { enum: ['high', 'med', 'low'] },
					file: { type: 'string' },
					claim: { type: 'string' },
					evidence: { type: 'string' },
				},
			},
		},
	},
}

const CLUSTERS = [
	{
		key: 'runner-gates',
		fixes: 'F1 (fatal+return on both verdict-gate paths), F8 (hash presence check), F27 (judgmentComplete gate)',
		files: 'scripts/ingest-podcast/index.mjs (the load-extraction stage branch)',
	},
	{
		key: 'extract-lib',
		fixes: 'F2 (seedTraps termination), F11 (quote-length gate), F12 (foreign chapter suppression + Q6 in-block close), F13 (malformed alias rows), F15 (elision adjacency)',
		files: 'scripts/ingest-podcast/extract-lib.mjs',
	},
	{
		key: 'extract-merge',
		fixes: 'F3 (untrusted timeline validation), F14 (cross-set alias collisions), F16 (malformed principle entries), F25 (cache validity spans all artifacts + fingerprint)',
		files: 'scripts/ingest-podcast/extract.mjs',
	},
	{
		key: 'load-paths',
		fixes: 'F9 (upsert repairs source), F28 (batched inserts), F29 (dup-pair refusal), F10 (repair innermost-layer validation)',
		files: 'scripts/ingest-podcast/load.mjs, scripts/ingest-podcast/load-extraction.mjs, scripts/repair-metadata-encoding.mjs',
	},
	{
		key: 'eval-machinery',
		fixes: 'F4 (keyHash build/score binding), F5 (verdict purge), F6 (gold number checks), F17 (per-kind trap floors + sub-floors), F18 (verdict validation + refuse-on-missing), F20-F24 (anchor/report/swap/underfill/prompt-hash)',
		files: 'scripts/extraction-eval.mjs',
	},
]

const prompt = (c) => `You are a fix-verification agent for the lumen repo, branch
feature/unshaken-extraction, cluster "${c.key}".

The review round claims these fixes landed: ${c.fixes}.
Finding details: docs/features/${slug}/bugs.md (the FIX bucket) and
docs/features/${slug}/reviews/code-adversarial/confirmed.json.
Code to examine IN FULL: ${c.files}.

For EACH fix in your cluster:
1. Verify the fix actually closes the finding's failure scenario — trace
   the exact input/sequence the finding described through the CURRENT code.
2. Hunt residuals: the same bug class elsewhere in the same file, partial
   fixes, and the fix's own edge cases.
3. Hunt regressions the fix introduced: changed signatures, behavior the
   harness pins, callers not updated.

Run the harnesses if useful: node --test scripts/__tests__/ingest-extraction.test.mjs
and scripts/__tests__/ingest-podcast.test.mjs.

Return: verified (list of fix ids you confirmed closed) and residuals
(anything NOT closed or newly broken — id like "R-${c.key}-1", severity,
file, one-sentence claim, code-quoting evidence). An empty residuals list
is a legitimate answer ONLY after tracing every fix.`

phase('Verify fixes')
const results = await parallel(
	CLUSTERS.map((c) => () =>
		agent(prompt(c), { label: `fixverify:${c.key}`, phase: 'Verify fixes', schema: RESIDUALS_SCHEMA, effort: 'high' })),
)
const live = results.filter(Boolean)
const residuals = live.flatMap((r) => r.residuals)
log(`fix-verification: ${live.flatMap((r) => r.verified).length} fixes verified, ${residuals.length} residuals`)
return { verified: live.flatMap((r) => r.verified), residuals }
