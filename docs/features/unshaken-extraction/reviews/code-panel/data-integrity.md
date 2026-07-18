# Data-integrity review — unshaken-extraction (code panel)

Scope: A2 load plan/executor (`scripts/ingest-podcast/load-extraction.mjs`),
A1 co-fixes (`scripts/ingest-podcast/load.mjs`, `index.mjs` executor),
`scripts/repair-metadata-encoding.mjs`. Contracts:
`scripts/__tests__/ingest-extraction.test.mjs` + plan.md §Design/§Eval.

Method: `git diff main...HEAD --stat`; all in-scope files read in full;
re-run sequences traced (A2×2; A1→A2→A1); both harnesses executed; drift
baseline hashes recomputed (all three match). `ingest-extraction.test.mjs`:
62/62 pass. `ingest-podcast.test.mjs`: 52/53 — one FAILURE (F2 below).
Partial unique index confirmed in `scripts/migrate-media-collections.mjs:40`:
`ON lumen.edges (from_id, to_id, rel_type) WHERE collection_id = 'unshaken'`.

Per instructions this reports EVERYTHING found, unfiltered; the adversarial
verification step arbitrates.

## Findings

### F1 — `fatal()` does not halt: a failed eval verdict races the load instead of blocking it (HIGH)

`scripts/ingest-podcast/index.mjs:330-339` (anchor :337)

Claim: the PW-A6 checkpoint gate (`verdict.passed !== true` → refuse load) is
enforced only by an event-loop race, because `fatal()` returns and execution
falls through into the episode loop, which begins issuing DB statements.

Evidence — `fatal()` (index.mjs:74-82) defers exit to a stream callback and
returns:

```js
if (logSink) {
    logSink.write(`${line}\n`);
    const t = setTimeout(() => process.exit(1), 500);
    t.unref?.();
    logSink.end(() => process.exit(1));
}
```

and the gate (index.mjs:336-338) has no `return`/`throw` after it:

```js
verdict = JSON.parse(readFileSync(verdictPath, 'utf8'));
if (verdict.passed !== true) {
    fatal(new Error('eval verdict is not a pass — load refused'), 'prereq');
}
for (const ep of episodes) { ... await executeExtractionLoadPlan(sql, plan, { log }); ... }
```

A failed verdict typically still carries matching `episodeHashes` (it judged
exactly this artifact and failed it), so the per-episode hash check does not
save you. Whether the `SELECT`/`DELETE`/`INSERT` sequence fires before
`process.exit(1)` depends on when the write-stream `finish` callback lands
relative to the first DB roundtrip. The "load-bearing wall" gate must be
`fatal(...); return finish(1);` or a throw — not a race. Same fall-through
exists for the missing-verdict branch (:332-334), though there the subsequent
`readFileSync(verdictPath)` throws ENOENT into the outer catch, so no write
can start (see F13).

### F2 — A1 pinned harness FAILS on this branch: stale STAGES pin (MED)

`scripts/__tests__/ingest-podcast.test.mjs:459`

Claim: the branch ships with a failing pinned contract — the B7 test still
pins the pre-A2 four-stage whitelist while `cli.mjs` now exports seven
stages; `node --test scripts/__tests__/ingest-podcast.test.mjs` fails 1/53.

Evidence:

```js
assert.deepEqual([...STAGES], ['discover', 'fetch', 'transcribe', 'load']);
```

vs `scripts/ingest-podcast/cli.mjs:5-13` adding `extract-code`,
`extract-merge`, `load-extraction`. plan.md §Files-touched says
"`ingest-podcast.test.mjs` is amended in this feature — its current pins
encode the old wiping behavior"; the delete/upsert pins were amended but this
one was missed. Divergence between code and pinned contract.

### F3 — hash-binding gate passes vacuously when both sides are `undefined` (MED)

`scripts/ingest-podcast/index.mjs:350`

Claim: the PW-A6 hash binding admits an episode whose extraction artifact
lacks `contentHash` when the verdict's `episodeHashes` also lacks that
episode key, because `undefined !== undefined` is `false`.

Evidence:

```js
if (verdict.episodeHashes?.[episodeId] !== extraction.contentHash) {
    throw new Error('extraction hash lacks a matching eval verdict — re-run the checkpoint');
}
```

A truncated/hand-edited extraction artifact with the `contentHash` key
removed, loaded with `--episode=<id>` against a verdict from a round that
never covered that episode, sails through the checkpoint that plan.md §Eval
describes as "load-extraction refuses any episode whose extraction hash
lacks a matching eval verdict". Both sides need presence checks
(`typeof extraction.contentHash === 'string'` and key-in-object).

### F4 — A1 upsert never repairs the `source` column: chimera row self-perpetuates and A2 later deletes a title anchor (MED)

`scripts/ingest-podcast/load.mjs:136-142` (anchor :137)

Claim: A1's `ON CONFLICT ... DO UPDATE` sets only `metadata`; if the
arbitration row is extraction-sourced, the row keeps
`source='unshaken-extraction'` with title-shaped metadata, and the next A2
run's scoped delete destroys that title anchor.

Evidence:

```sql
ON CONFLICT (from_id, to_id, rel_type) WHERE collection_id = 'unshaken'
DO UPDATE SET metadata = jsonb_build_object(
  'source', 'title', 'confidence', 1,
  'mentions', COALESCE(...))
```

Sequence that produces the conflict against an extraction-sourced row: the
episode title's parsed block CHANGES between runs to include chapter Y that
A2 had previously written as an extraction-sourced DISCUSSES edge (A2
classifies chapter pairs as INSERT whenever no `source='unshaken-youtube'`
row exists — `load-extraction.mjs:23-27,54-66`). A1's upsert then collides
on the partial unique index (source is not part of the index), rewrites
metadata, leaves `source='unshaken-extraction'`. Next A2 run:
`EXISTING_EDGES_SQL` (title-filtered) doesn't see it → classifies INSERT →
`delete-extraction-edges` DELETES the anchor A1 just wrote, and reinserts it
as `source='unshaken-extraction'` with `metadata.source='extraction'` and
max-mention confidence instead of the confidence-1 anchor. The
misclassification is permanent (every later A1 upsert hits the same row and
still never fixes `source`), and both smokes filter on
`source='unshaken-youtube'`, so `anchors_resolve_to_chapters` and the
confidence-1 invariant never see the row. Fix: `DO UPDATE SET metadata = ...,
source = 'unshaken-youtube'`.

### F5 — repair dry-run accepts ARRAYS as "objects", contradicting its own abort contract (MED)

`scripts/repair-metadata-encoding.mjs:63`

Claim: the EV-A11 validation ("scalar/array content would ship garbage" —
the comment at :46-47; plan.md: "asserting object-typeof") classifies JSON
arrays as valid objects, so a string row whose content is an array passes
DRY_RUN and is unwrapped into jsonb-array metadata garbage.

Evidence:

```js
if (typeof parsed === 'string') doubleWrapped += 1;
else if (parsed !== null && typeof parsed === 'object') objects += 1;
```

`typeof [1,2] === 'object'` and `[1,2] !== null` → counted in `objects`,
never in `unparseable`. After unwrap, `jsonb_typeof = 'array'`, which the
in-tx invariant (:95-98, strings only) and the post-state report both pass.
Needs `&& !Array.isArray(parsed)`.

### F6 — repair validates only ONE unwrap layer of double-wrapped rows; inner garbage ships or aborts mid-tx (LOW)

`scripts/repair-metadata-encoding.mjs:61,83-91`

Claim: for `doubleWrapped` rows the dry-run never asserts the INNER value is
an object, so commit either ships non-object jsonb (inner array/number stops
the loop because it is no longer `'string'`-typed, and the string-only
invariant passes) or throws inside the tx on unparseable inner text —
violating the stated "abort before any write" contract (rollback keeps it
safe, but the dry-run green light was false).

Evidence: `if (typeof parsed === 'string') doubleWrapped += 1;` — counted
and reported, never recursed into; the unwrap loop then applies
`(metadata #>> '{}')::jsonb` blindly per pass. Example: outer string content
`"[1,2]"` → dry-run says doubleWrapped, commit pass 1 yields jsonb string
`[1,2]`… pass 2 yields a jsonb ARRAY → invariant (strings=0) passes →
shipped. Recursively re-parse `doubleWrapped` rows in the dry-run until an
object is reached, else count unparseable.

### F7 — A2 executor is per-row, not batched: diverges from plan §Design item 5 (LOW)

`scripts/ingest-podcast/load-extraction.mjs:78-122` (anchor :116)

Claim: plan.md §Design load step 5 pins "Batched statements, SET LOCAL
guards, house logging", but `executeExtractionLoadPlan` issues one
round-trip per edge (one UPDATE or INSERT each) inside a 60s-timeout tx —
the exact per-row-through-the-pooler pattern the A1 run-1 lesson
(load.mjs:95-97) exists to avoid.

Evidence: `for (const s of plan.statements) { ... await tx\`INSERT INTO
lumen.edges ... VALUES (${s.episodeId}, ...)\` }`. Episode edge counts
(~100–365 candidate targets) are likely fine at 60s, but it is a divergence
between code and the pinned plan text, and a slow pooler makes the tx
timeout a real failure mode.

### F8 — A2 classification read is outside the write transaction (LOW)

`scripts/ingest-podcast/index.mjs:353` vs `load-extraction.mjs:75`

Claim: `EXISTING_EDGES_SQL` runs on the pool connection before
`buildExtractionLoadPlan`, and the tx opens afterwards, so classification
can be invalidated by a concurrent A1 run (title edge deleted → UPDATE
rowCount 0 → loud abort; title edge added → INSERT unique-violation → loud
abort).

Evidence: `const existingEdges = await sql.unsafe(EXISTING_EDGES_SQL, ...)`
then later `await executeExtractionLoadPlan(sql, plan, ...)` which calls
`sql.begin`. Failure is loud in both directions (the rowCount assert and the
partial unique index do their jobs), so this is an availability/atomicity
note, not silent corruption — but a `SELECT ... FOR UPDATE` inside the tx
(or moving the fetch into `sql.begin`) would close it.

### F9 — plan builder never asserts (toId, relType) uniqueness within one episode's edges (LOW)

`scripts/ingest-podcast/load-extraction.mjs:38-67` (anchor :41)

Claim: duplicate `(toId, relType)` entries in `extraction.edges` that both
classify UPDATE silently double-update the same title edge (each touches
exactly 1 row, so the rowCount assert passes; last write wins), instead of
aborting.

Evidence: the loop pushes one statement per input edge with no seen-set;
`aggregateToEdges` guarantees uniqueness for artifacts it wrote, but the
load path re-reads the artifact from disk (`index.mjs:348`) and trusts its
shape. Duplicates on the INSERT path abort loudly via the unique index;
only the UPDATE path is silent. Cheap fix: a `Set` over `toId|relType` with
a throw.

### F10 — A1 stale-anchor delete with empty `chapterIds` deletes EVERY title edge for the episode (LOW)

`scripts/ingest-podcast/load.mjs:39-44` (anchor :42)

Claim: `to_id != ALL($3)` with `$3 = []` is true for every row, so an
episode whose parse yields zero chapter anchors has ALL its
`unshaken-youtube` edges deleted (including A2-written chapter mentions
stored on them) and none re-inserted (the DISCUSSES loop body never runs).

Evidence:

```js
text: `DELETE FROM lumen.edges
WHERE from_id = $1 AND collection_id = $2
  AND source = 'unshaken-youtube' AND to_id != ALL($3)`,
values: [episodeId, show.id, chapterIds],
```

Secondary: postgres.js type inference for an empty JS array parameter is
`unknown[]`; depending on version this can error at bind time rather than
run. Today `anchorsForBlock` on a parseable title presumably always yields
≥1 chapter, so this is a guard-rail gap (an explicit
`if (chapterIds.length === 0) throw` would make it loud).

### F11 — load-extraction never checks `judgmentComplete`: partial-judgment artifacts are loadable (LOW)

`scripts/ingest-podcast/index.mjs:347-364` vs `scripts/ingest-podcast/extract.mjs:561-575`

Claim: `runExtractMerge` writes the extraction artifact even when judgment
artifacts are missing/unparseable (`judgmentComplete: false`,
`judgmentMissing: [...]`, principles silently absent), and the load path
gates only on `contentHash` — so an eval verdict computed over a
partial-judgment artifact green-lights loading an episode with silently
reduced principle/alias coverage.

Evidence: extract.mjs:564 `judgmentComplete: judgment.missing.length === 0`
followed unconditionally by `writeArtifactAtomic(paths.extraction, ...)`;
index.mjs load branch checks only the hash. This is consistent CONTENT
(hash-bound) but diverges from the H5 spirit pinned in the harness
("missing chunk → episode incomplete, mentions withheld") — the withholding
exists in `assembleEpisode` but the judgment-artifact path around it does
not refuse.

### F12 — trap refusal is edge-level only; mention-level `__trap` would pass into metadata (LOW)

`scripts/ingest-podcast/load-extraction.mjs:16-22` (anchor :17)

Claim: `buildExtractionLoadPlan` throws on `e.__trap` on edge objects but
never inspects `e.mentions[i]`, so a trap marker inside a mentions array
would serialize into jsonb metadata unchecked.

Evidence: `for (const e of edges) { if (e.__trap) throw ... }` — no mention
scan. Structurally traps only ever exist in the separate eval-sample file
(H8 pins that the sample carries no `__trap` field at all and the answer key
is separate), so this is defense-in-depth on the H8 containment, not an
active leak path.

### F13 — missing-verdict path double-reports fatal and relies on a downstream throw (LOW)

`scripts/ingest-podcast/index.mjs:332-335` (anchor :333)

Claim: when `eval-verdict.json` is absent, `fatal()` is called but execution
continues into `JSON.parse(readFileSync(verdictPath, 'utf8'))`, which throws
ENOENT into the outer catch — emitting a SECOND `fatal` event and racing
`finish(1)` against the pending `fatal` exit.

Evidence: same fall-through mechanics as F1; here no write can start (the
throw happens before the loop), so it is log noise + fragile control flow
rather than a write hazard — but it shows the gate's safety is accidental
(it depends on the very file-read that was just declared missing).

### F14 — repair COMMIT run has an unlocked window between JS validation scan and the unwrap tx (LOW)

`scripts/repair-metadata-encoding.mjs:48-100` (anchor :80)

Claim: the dry-run scan (outside any tx) and the commit tx are not isolated
from concurrent writers, so a string-typed row written between scan and
unwrap is unwrapped without ever being JS-validated.

Evidence: the scan loop at :48-73 runs on the pool connection; `sql.begin`
opens at :81 with a fresh `WHERE ... jsonb_typeof(metadata) = 'string'`
predicate that will pick up rows the scan never saw. Post-fix writers emit
objects and this is a one-time migration run by hand, so practical exposure
is near zero — recorded for completeness.

## Verdict

The core A2 contracts hold: the harness passes 62/62 against the code, the
drift-baseline hashes all match, `EXISTING_EDGES_SQL` is title-filtered and
pinned, the scoped delete → re-INSERT is idempotent under A2×2, the title
UPDATE is whole-object/replace with a rowCount===1 assert, the preflight
opens every plan inside the tx, and both executors now pass raw objects to
postgres.js (single serialization; F1-audit pin present). The
A1→A2→A1 mentions-preservation path works in the normal case.

However: (1) the eval-verdict gate — the plan's "load-bearing wall" — is
enforced by an event-loop race, not by control flow (F1); (2) the branch
ships a failing pinned A1 harness (F2); (3) the hash-binding checkpoint has
a vacuous-pass hole (F3); (4) a title-block change across runs creates a
source-column chimera that a later A2 run destroys, invisible to every smoke
(F4); and (5) the repair migration's object-typeof assertion admits arrays
and never validates inner layers of double-wrapped rows (F5/F6). F1–F5 need
fixes (or explicit refutation) before this load path touches prod again.
