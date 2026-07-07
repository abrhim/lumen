# Panel 2 — Adversarial Review of Panel 1's Migration Safety Review (canon-spine)

Verified against `apps/web/.env` / `.env.example`, `scripts/setup-readonly-role.sql`,
`docs/design/canon-spine.md`, `docs/features/canon-spine/plan.md`, `.gitignore`,
and prior ingest scripts (`ingest-phase-a.ts`, `backfill-phase-b.ts`,
`backfill-neo4j-collections.mjs`).

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| MIG-1 | material | Confirmed: `apps/web/.env` carries only `lumen_read` (SELECT-only per `setup-readonly-role.sql`); no root/admin `.env` exists, `.env` is gitignored. Real DDL blocker. |
| MIG-2 | material | Confirmed: Supavisor 5432=session, 6543=transaction; Supabase itself warns against transaction-mode for DDL. Current `.env` uses 5432 by luck, script has no assertion. |
| MIG-3 | risky | Overstates cost: P1 is one atomic transaction (design.md) — bad state can't commit; words table is currently empty, so "1.2M-row re-ingest" conflates not-yet-run work with data loss. Cheap `pg_dump`/PITR note still worth adding, but not blocker-grade given 0 users + re-ingestable source. |
| MIG-4 | material | Confirmed gap: plan.md line 83 asserts `--dry-run` with zero mechanics specified — real ambiguity, real consequence (false confidence or accidental prod execution). |
| MIG-5 | risky | Valid in principle, but no cron/multi-actor trigger exists in this repo — single developer runs one script at a time by design. Worth naming, not urgent. |
| MIG-6 | risky | Core claim is wrong: Postgres `SET NOT NULL` does not error on rerun, and P1's one-transaction design (design.md) means partial-failure state can't exist to rerun against. Real gap is `ADD COLUMN` needing `IF NOT EXISTS`, already implied by plan's own "IF NOT EXISTS + upserts" contract. |
| MIG-7 | material | Confirmed precedent: `backfill-neo4j-collections.mjs` uses `BATCH_SIZE=2000`. Plan states none for a 1.2M-row ingest over the Supabase pooler — concrete, actionable gap. |
| MIG-8 | material | Real gap confirmed: Files touched lists one migration script for all P1–P4, no flag/marker named. Note: the "true point of no return" quote does not appear verbatim in plan.md or design.md — panel-1 paraphrased as a direct quote; docking for sloppy attribution, not for the underlying finding. |
| MIG-9 | risky | Confirmed precedent (`log()`, `scrub()`, `exitCode = 2` in `backfill-neo4j-collections.mjs`) is real and the ask is cheap, but correctly scored Low by panel-1 — polish, not a safety gate. |

## Stance

Panel-1's table holds up well under adversarial pressure — five of nine items
(MIG-1, 2, 4, 7, 8) are verified, concrete, and correctly targeted; I'd ship
fixes for all five as written. MIG-1 is real and correctly the sole Blocker:
`apps/web/.env` (the only credential on this machine) is provably read-only,
`.env` is gitignored so nothing is "hiding" elsewhere, and DDL cannot run
without a privileged path — keep it Blocker, keep it gating.

The one place panel-1 reasoned reflexively rather than honestly is MIG-3.
"No backup" reads as an obvious High-severity gap only if you ignore two
things the design doc itself states: P1 is a single atomic transaction (so a
bad backfill rolls back completely — it can't partially corrupt live data),
and the words table this "costly re-ingest" refers to is *currently empty*
(§Schema: "rebuild of the empty table"). The real exposure is narrow — the
`verses.chapter_id` backfill inside P1 — and that's exactly the piece already
protected by transactionality plus the plan's own in-transaction invariant
aborts. Given 0 users, one developer, and a fully re-ingestable LDS
Documentation Project source, a backup step is good hygiene (cheap, add it)
but not a load-bearing safety gate; I downgraded it to risky rather than
letting the panel's "High" stand unchallenged.

MIG-6 has a factual error at its core (Postgres does not error on a repeated
`SET NOT NULL`, and the one-transaction design means there's no partial-apply
state to rerun into) but the instinct — double-check every DDL statement in
the migration is rerun-safe, not just the `CREATE TABLE`s — is worth keeping
as a lightweight risky item rather than discarding outright. MIG-5 is sound
reasoning applied to a threat (concurrent ingest) that has no actual trigger
in this single-developer repo, so it's real-but-low-urgency, not blocking.
MIG-9 is accurate and cheap but correctly scoped Low already — no argument,
just doesn't carry blocking weight.

Net: panel-1's review is honest and well-sourced overall; its one failure
mode is treating "no explicit backup step" as inherently unsafe without
weighing it against the transactional design and re-ingest cost the same
plan/design docs already establish.
