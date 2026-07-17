# Panel-2 — aggregated (unshaken-ingest A1)

2026-07-17 · 4 adversarial taggers (Opus, one per panel-1 role, per-role files
canonical). **Dissent rate: 20/32 = 0.625** (non-material tags / total).

| Role | material | risky | out-of-scope | noise |
|---|---|---|---|---|
| security-secrets | SEC-1,2,4,5,7 | SEC-3 | — | SEC-6,8 |
| correctness-data | COR-1,2,5 | — | — | COR-3,4,6,7 |
| pipeline-reliability-cost | REL-1,3 | REL-4,6,8 | — | REL-2,5,7 |
| contract-observability | CON-7,8 | CON-1,5 | CON-6 | CON-2,3,4,9 |

## Evidence-backed refutations (dissent in the kill direction)

- **REL-2 (was high)**: yt-dlp `.part` + atomic-rename is the verified DEFAULT
  (`--no-part` is the opt-out) — the truncated-final-file premise is false.
  One-line residual adopted: H3 asserts `--no-part` is never passed.
- **CON-9 (was high)**: the §rules-3 "contradiction" dissolves — A1's mentions
  array is EMPTY; there is no mention for per-mention confidence to attach to.
- **SEC-6**: leak mechanism refuted (validated-utterances-only artifact,
  gitignored, no key in Deepgram response body).
- **CON-4**: premise dissolves against the proto's actual descriptor usage.

## Live-data verification (the round's sharpest work)

- **COR-1 fix bisected against prod**: delete-first half is house pattern
  (openbible:218, art:244, phase-b:394) → adopt; unique-index half would ABORT
  the migration on **1,578 existing phase-b duplicate edge tuples** → reject.
  Synthesis replaces it with a partial unique index
  `WHERE collection_id = 'unshaken'` (no live rows → safe).
- **SEC-7 traced end-to-end**: DB grant without the entitlements-keys.ts key
  bricks grant-role.mjs via decideRole's unknown-key refusal.
- **SEC-3's proposed fix executed the brief's own trap**: PATH-only child env
  breaks yt-dlp (HOME/TMPDIR). Amended fix: subtractive env (strip
  DEEPGRAM_API_KEY + DATABASE_URL, keep the rest).

## Synthesizer notes (for retro)

- Safety carve-out exercised: SEC-3 (security-high) survives its risky tag with
  amended fix. REL-2's carve-out considered and declined — the premise is
  factually refuted with tool evidence; residual assertion adopted instead.
- Tag/prose mismatch: REL-8 tagged risky while its rationale argues the fix is
  fail-safe and cheap — synthesizer followed the substance (incorporated:
  `public=false` until B flips deliberately). Logged as a tagging-quality note.
- REL-4's fix is substantially delivered by CON-8's H10 skip-validity gate
  (artifact-exists ⇒ skip only when valid); rejected as a separate mechanism.
