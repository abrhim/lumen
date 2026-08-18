export const meta = {
	name: 'unshaken-eval',
	description: 'Eval checkpoint for unshaken extraction — sharded refute-framed evaluators over self-contained packets',
	whenToUse: 'After extraction-eval.mjs --build; verdicts feed --score. args: {round: N, shards: M}',
	phases: [{ title: 'Evaluate', detail: 'one restricted evaluator per shard, hash-pinned prompt' }],
}

// EV-A3 mechanics: evaluators run from the version-controlled, hash-pinned
// prompt file with exactly one parameter (the packet path). No free-text
// instruction from the orchestrator; packets are self-contained; the answer
// key is recomputed at scoring — it does not exist on disk.

const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
const round = parsedArgs?.round
const shards = parsedArgs?.shards
if (!Number.isInteger(round) || !Number.isInteger(shards)) {
	throw new Error('args {round: N, shards: M} required')
}

const VERDICT_SCHEMA = {
	type: 'object', additionalProperties: false, required: ['verdicts'],
	properties: {
		verdicts: {
			type: 'array',
			items: {
				type: 'object', additionalProperties: false, required: ['id', 'verdict', 'anchor_ok', 'evidence'],
				properties: {
					id: { type: 'string' },
					verdict: { enum: ['correct', 'wrong', 'insufficient-evidence'] },
					anchor_ok: { type: 'boolean' },
					evidence: { type: 'string' },
				},
			},
		},
	},
}

const show = parsedArgs?.show ?? 'unshaken'
if (!/^[a-z0-9-]+$/.test(show)) throw new Error(`unsafe show id: ${show}`)
const packet = (i) => `data/podcasts/${show}/eval/round-${round}/shard-${String(i).padStart(2, '0')}.json`

const evaluatorPrompt = (i) => `Read docs/features/unshaken-extraction/eval-prompt.md and execute it
EXACTLY, with this single parameter:

  packet: ${packet(i)}

Read ONLY those two files — the prompt file and the packet. Do not read any
other repo file, artifact, plan, or review document; the packet is
self-contained by design and consulting anything else voids the eval.

When done: Write your verdicts JSON to ${packet(i).replace('.json', '.verdict.json')}
using the Write tool, and return the same JSON as your structured output.`

phase('Evaluate')
log(`evaluating round ${round}: ${shards} shards`)

const results = await pipeline(
	Array.from({ length: shards }, (_, i) => i),
	(i) => agent(evaluatorPrompt(i), { label: `eval:shard-${i}`, phase: 'Evaluate', schema: VERDICT_SCHEMA, effort: 'high' }),
)

const done = results.filter(Boolean)
const counts = done.map((r) => r.verdicts.length)
log(`verdicts in: ${done.length}/${shards} shards, ${counts.reduce((a, b) => a + b, 0)} items`)
return { shardsCompleted: done.length, shardsTotal: shards, itemCounts: counts }
