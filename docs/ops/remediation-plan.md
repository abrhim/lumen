# Remediation plan v2 — post-review (2026-07-19)

v1 (82e11de) was adversarially reviewed by two agents on Abram's direction:
a **fix-correctness adversary** (41 tool calls, live prod + graph probes) and
a **prioritization adversary** (code-evidence sequencing attack). Three of
v1's five decision-shaping premises were REFUTED; v2 is the corrected plan.
Review log at bottom. Rule in force: every fix ships with a BEHAVIOR test
(both reviewers flagged string-regex pins as a house weakness — pins must
exercise behavior, not SQL text).

---

## Revised verdict on sequencing (the headline change)

**Phase B starts immediately — nothing gates it.** All three of v1's
"pre-Phase-B" items were refuted by code evidence: no JST surface exists in
the app; nothing at runtime consumes the stale drizzle defs (`drizzle(client)`
is schemaless, all queries raw SQL); the graph re-sync touches only scripts.
The public flip is the product milestone; hygiene runs beside it, not in
front of it.

**The two true "now" items are one command and one cron:**
- **N1 — Backup push of main** (~130 unpushed commits on one laptop, live
  prod). If origin/main must stay frozen: `git push origin main:backup/main-2026-07-19`.
  One command, zero risk. *(v1 buried this in a subordinate clause — promoted
  on review.)*
- **N2 — Stress harness as a scheduled sweep** (P3→**P1**: it is the
  enforcement layer for every pin below — items 1, 2, 5, 6, 9 all cite
  "stress I-n flips" as their pin, which only fires if the harness runs).
  Read-only, ~8 min. Wire as a post-ingest step before the weekly episode
  cadence starts. **It also hosts the schema-drift pin** (see item 3 — the
  live `information_schema`-vs-drizzle diff belongs here, not in a committed
  snapshot that CI would never see drift against prod).

## P0 — parallel track beside Phase B

### 1. Graph re-sync: D&C (92%) **+ PGP (100%)** — node **and edge** sync
- **Corrected scope** (both reviewers): missing = 3,360 D&C verses + **all
  635 PGP verses** (= the exact 3,995); the cut is mid-chapter (dc-14-9 is
  graph verse #294 in canonical order — clean truncation of the original
  pre-repo build; `source: 'anthropic-batch'`). Chapter picture is
  3-missing/