# Panel-1 — aggregated (unshaken-ingest A1)

2026-07-17 · tier large · 4 combined briefs (approved 1b deviation from 8 solo
roles, per art-graph combined-brief learning) · per-role files are source of
truth; this file is the overwritten aggregate.

**32 findings — 10 high / 15 med / 7 low.**
security-secrets: 3/4/1 · correctness-data: 1/4/2 · pipeline-reliability-cost:
3/3/2 · contract-observability: 3/4/2.

## Canonical findings

Full tables live in the per-role files; IDs are canonical and stable:

- [security-secrets.md](panel-1/security-secrets.md) — SEC-1..8
- [correctness-data.md](panel-1/correctness-data.md) — COR-1..7
- [pipeline-reliability-cost.md](panel-1/pipeline-reliability-cost.md) — REL-1..8
- [contract-observability.md](panel-1/contract-observability.md) — CON-1..9

## Cross-cutting themes (aggregator's read, not findings)

1. **Harness-gap cluster** — the largest: SEC-1 (H9 promises scrub-per-stage,
   tests only request shape), CON-5 (H8 asserts A/B but not C weight), CON-8
   (resumability has no H at all), COR-2 (anchor→edge-row count untested),
   COR-3 (index idempotency counted 1 of 3), COR-6 (overlap passes
   "monotonic"), REL-1 (no duration-vs-transcript-end check). Pattern: stated
   invariants whose tests try the benign shape — the exact user-roles failure
   class the plan itself cites.
2. **Idempotency hole** — COR-1 (high): edges have no PK/unique/cascade;
   delete-pass coverage for edges is neither planned explicitly nor tested.
   Silent DISCUSSES duplication on every re-run.
3. **Plan-omission family** — SEC-7 (entitlements-keys.ts missing from Files
   touched), CON-2 (parse-title.mjs likewise), CON-1 (discover→load shape
   transform unowned).
4. **Design-doc contradictions** — CON-9 (edge-level confidence vs §rules-3
   per-mention), REL-8 (public defaults true vs kill-switch framing).
5. **Driver-type trap** — COR-5: postgres.js returns numeric as STRING;
   ±2s smoke comparison would be lexicographic. Same shape as user-roles B2.
6. **External-reality checks** — REL-3 (sync upload of 6.1h/500MB unverified),
   REL-6 (keyterm limit unverified), SEC-8 (yt-dlp unpinned).

## Aggregator notes

- Emergent dedup: correctness-data read sibling files mid-review and dropped
  two drafted findings already covered (H8 C-weight → CON-5; entitlements-keys
  omission → SEC-7). No duplicate IDs survive; SEC-7 and CON-5 carry
  raised_by: [security-secrets|contract-observability, correctness-data].
- Overrun: correctness-data ran ~15.5 min (3× the 5-min soft target) — for
  retro §wasted-effort; its COR-1/COR-5 are arguably the panel's two sharpest
  findings, so the overrun bought signal.
- No timeouts, 4/4 returned, no restart needed.
