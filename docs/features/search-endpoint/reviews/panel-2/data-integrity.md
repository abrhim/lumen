# Panel-2 — adversarial tags for data-integrity

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| DAT-1 | material | Re-probed: 0/65,877 entities weighted despite load.mjs:74-76 writing setweight — trigger clobbers proven; trigger-first ordering plus SET text=text backfill changes M2 design. |
| DAT-2 | material | Re-probed: 5,319/5,319 naves_topics degree-0; ln(1+0)=0 zeroes the entire topics group and leaves H10 ordering undefined. Fix is correct and minimal. |
| DAT-3 | material | Verified load.mjs:32-48: re-ingest cascades transcripts, deletes only kind='episode' — moments keep dead seq ranges. Fix stays outside ingest pipeline, so in-scope. |
| DAT-4 | material | Plan leaves rebuild atomicity unpinned on a table shared with load.mjs:46 writer; per-episode transaction plus wildcard-safe kind-scoped deletes prevent real partial states cheaply. |
| DAT-5 | material | Without PK(variant), duplicate keys make normalize_kjv nondeterministic; plan decision 10's eval gate checks lexeme inequality but not closure. Concrete DDL/gate change. |
| DAT-6 | material | No ref_id FK and NO ACTION collection FK (specialist probe); entity deletes happen routinely (load.mjs:32), so script-time orphan invariants on ~28k projection rows are real guards. |
| DAT-7 | noise | Probed: autovacuum on, threshold 50/scale 0.1/naptime 60s — backfills trigger autoanalyze within ~1min; batch pinning restates plan.md:20,112 (openbible pattern already mandated). |
| DAT-8 | noise | Probed current_user=postgres, exactly the pg_default_acl grantor, so grants auto-apply; plan.md:42,103 already mandate per-script invariant checks and DRY_RUN=1 default (plan.md:20). |
| DAT-9 | noise | plan.md:126 already assigns refresh to a script; log-damped boost drift is ranking-cosmetic; finding itself concedes DAT-2's COALESCE neutralizes missing rows. |
| DAT-10 | noise | Probe confirms public=true, but memory/unshaken-surfaces-deployed.md records a deliberate 2026-07-21 flip (kill switch public=false); harness:54 hard-codes lists so H8 mechanics hold — only a comment is stale. |

## Stance

Mostly signal: every citation I re-verified reproduced exactly (0/65,877 weighted entities, 5,319/5,319 degree-0 topics, load.mjs:32-48/74-76, harness comment at line 53), and DAT-1 through DAT-6 would genuinely change the migrations, DDL, and scoring that ship — DAT-1/DAT-2 alone justify the panel. The four lows are hygiene: they restate house patterns already mandated by the plan, flag a stats gap autoanalyze closes in about a minute, or raise a visibility question the unshaken-surfaces deployment record already answers as deliberate.