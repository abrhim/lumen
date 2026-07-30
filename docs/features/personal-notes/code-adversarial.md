# Code-adversarial aggregate — personal-notes (step 10, panel-2)

Synthesized from the nine adversarial tagger files in
`docs/features/personal-notes/reviews/code-adversarial/` (one per code-panel
lane) plus the opus meta-review (`reviews/code-adversarial/meta.md`), over the
canonical CP-1..73 set in `code-panel.md`. Date: 2026-07-30.

Tag rules per `references/adversarial.md`: exactly one tag per panel-1 finding
(material / risky / noise / out-of-scope), tie-break
**material > risky > out-of-scope > noise**. Where a CP merges findings from
multiple lanes, the CP-level outcome is the highest tag any contributing lane
assigned (same tie-break).

## Tag histogram per lane

| Lane | Rows | material | risky | out-of-scope | noise |
|---|---|---|---|---|---|
| security | 10 | 9 | 0 | 1 | 0 |
| correctness | 16 | 15 | 0 | 0 | 1 |
| api-contract | 10 | 9 | 0 | 1 | 0 |
| data-integrity | 11 | 7 | 0 | 0 | 4 |
| ux | 18 | 18 | 0 | 0 | 0 |
| accessibility | 13 (12 + 1 out-of-lane) | 12 | 0 | 0 | 1 |
| performance | 9 | 5 | 3 | 0 | 1 |
| observability | 10 | 9 | 0 | 0 | 1 |
| blast-radius | 8 (5 findings + 3 verified-clean entries) | 3 | 0 | 0 | 5 |
| **Total** | **105 rows / 102 findings** | **87** | **3** | **2** | **13** |

Material rate 85% of findings; dissent rate 15% (15/102). Three of
blast-radius's noise rows (BR-5/6/8) are verified-clean audit entries, not
findings — the taxonomy has no "clean" tag (see meta red flag 5).

## Per-CP tag outcomes

Outcome = highest lane tag under the tie-break. Lane disagreements on a shared
CP are noted; there is exactly one true conflict (CP-47).

| CP | Sev | Lane tags | Outcome |
|---|---|---|---|
| CP-1 | Critical | correctness m×3 (C-1/2/12), ux m×2 (UX-3/14), performance m (P-3) | **material** — unanimous, 6 findings, 3 lanes |
| CP-2 | Critical | ux m (UX-1) | **material** (tagger confirmed via repo-wide CSS grep; noted body text IS utility-styled — headings/lists/blockquotes/wikilinks flat as claimed) |
| CP-3 | High | correctness m, api-contract m, data-integrity m, observability m | **material** — unanimous across all 4 lanes |
| CP-4 | High | correctness m (C-3), ux m (UX-7) | **material** |
| CP-5 | High | security m (SEC-1), api-contract m (A-2) | **material** (one severity-sizing note logged, see carve-out log) |
| CP-6 | High | security m (SEC-5), api-contract m (A-1, A-10 half) | **material** |
| CP-7 | High | correctness m (C-4), api-contract m (A-4) | **material** (expansion mechanism confirmed in prosemirror-markdown source) |
| CP-8 | High | blast-radius m (BR-1) | **material** (tagger independently refuted the in-code "rides the root loader" comment) |
| CP-9 | High | data-integrity m (DATA-1) | **material** |
| CP-10 | High | performance m (P-1) | **material** (oracle false negative re-verified against checker source) |
| CP-11 | High | accessibility m (A11Y-1) | **material** |
| CP-12 | High | ux m (UX-2) | **material** |
| CP-13 | High | ux m (UX-4) | **material** (all three sub-claims re-derived from search.tsx) |
| CP-14 | High | observability m (OBS-1) | **material** — tagger found a CLEANER reachable vector: client-supplied `base_updated_at` → PG 22P02 echoes the raw string into `note_write_failed.message`; fold into the fix + fixture |
| CP-15 | Med | observability m, blast-radius m, api-contract m (A-9b) | **material** — unanimous, 3 lanes |
| CP-16 | Med | security m (SEC-4), data-integrity m (DATA-3), performance m×2 (P-6/7) | **material** — unanimous, 3 lanes |
| CP-17 | Med | correctness m (C-9), accessibility m (A11Y-2) | **material** |
| CP-18 | Med | correctness m (C-8), security m (SEC-9) | **material** |
| CP-19 | Med | correctness m (C-6), security m (SEC-6) | **material** (C-6's "straight from the form" phrasing corrected — label does route through the sanitizer; the sanitizer's insufficiency is the defect and stands) |
| CP-20 | Med | security m (SEC-3), data-integrity m (DATA-6) | **material** (hardcoded-`true` check byte-verified by both lanes) |
| CP-21 | Med | security m (SEC-2), blast-radius m (BR-7) | **material** |
| CP-22 | Med | accessibility m (A11Y-4), ux m (UX-11) | **material** |
| CP-23 | Med | performance risky×2 (P-2/5) | **risky as tagged; META RULING: material** — the tagger's own first clause concedes the projection gap is real; material > risky. Split resolution: incorporate the no-schema-change half (drop `body_md` from the list read), record the generated-column rejection (title-derivation divergence) verbatim |
| CP-24 | Med | api-contract m (A-3) | **material** |
| CP-25 | Med | observability m (OBS-2) | **material** |
| CP-26 | Med | observability m (OBS-5) | **material** |
| CP-27 | Med | observability m (OBS-6) | **material** (minor overreach noted: `anchor_invalid` DOES emit; ⅔ of claim (a) holds) |
| CP-28 | Med | data-integrity m (DATA-4) | **material** (fix checked for app breakage — column-scoped grants safe) |
| CP-29 | Med | data-integrity m (DATA-5) | **material** |
| CP-30 | Med | performance risky (P-4) | **risky** — stands per meta: fix plumbs viewRef into the A19 crash-preservation boundary; regression risk exceeds the sub-millisecond defect |
| CP-31 | Med | correctness m (C-7) | **material** |
| CP-32 | Med | correctness m (C-10) | **material** |
| CP-33 | Med | correctness m (C-11) | **material** |
| CP-34 | Med | ux m (UX-5) | **material** (enforcement of A4, not relitigation) |
| CP-35 | Med | ux m (UX-6) | **material** (enforcement of A6/CF-36) |
| CP-36 | Med | ux m (UX-8) | **material** |
| CP-37 | Med | ux m (UX-9) | **material** |
| CP-38 | Med | ux m (UX-10) | **material** |
| CP-39 | Med | accessibility m (A11Y-3) | **material** |
| CP-40 | Med | accessibility m (A11Y-5) | **material** |
| CP-41 | Med | accessibility m (A11Y-6) | **material** |
| CP-42 | Med | accessibility m (A11Y-9) | **material** (rhetorical "sheltered by the exclusion" overreach discounted; substantive claims verify) |
| CP-43 | Low | security m (SEC-7), ux m (UX-12), accessibility m (out-of-lane) | **material** — unanimous, 3 lanes; NUL bytes independently byte-scanned by all three |
| CP-44 | Low | api-contract m (A-7), observability m (OBS-8) | **material** |
| CP-45 | Low | observability m (OBS-10), api-contract m (A-9a) | **material** |
| CP-46 | Low | correctness m (C-16), api-contract m (A-10 half) | **material** |
| CP-47 | Low | api-contract **m** (A-8) vs blast-radius **noise** (BR-3) | **material** — the panel's ONLY cross-lane conflict; a merge artifact, not a tagger error (BR-3 proposed no change; the sharp half — search.tsx:279 session read outside the 500-contract try — is API-CONTRACT-8's). Resolve scoped to the A-8 half; BR-3's header-delta note rides as a plan/deploy-checklist line |
| CP-48 | Low | security out-of-scope (SEC-8) | **out-of-scope** — no present caller can reach the string-built `.or()`; future seam-hardening. Needs a concrete home (issue/retro rec) |
| CP-49 | Low | security m (SEC-10) | **material** (14-vs-15 invariant count must be resolved before the deploy checklist) |
| CP-50 | Low | api-contract out-of-scope (A-6) | **out-of-scope** — meta flags as the most contestable non-material tag (soft tie-break question); minimum resolution is a plan note on the narrower capture-intent 409 shape |
| CP-51 | Low | correctness noise (C-13) | **noise** — A2-compliant behavior; deliverable reduces to a comment correction |
| CP-52 | Low | correctness m (C-14) | **material** |
| CP-53 | Low | correctness m (C-15) | **material** — STRENGTHENED by tagger: `slice(0, 6)` suggestion cap makes equal-length lists routine, not edge-case; fold into fixture |
| CP-54 | Low | data-integrity m (DATA-7) | **material** (add RPC-shape probes; keep raw-insert probes too) |
| CP-55 | Low | data-integrity noise (DATA-8) | **noise** — refuted: soft-delete bumps `updated_at`, so the CAS blocks today's path; residual window is ms-scale, self-inflicted, purge-cascaded |
| CP-56 | Low | data-integrity noise (DATA-9) | **noise** — refuted: `append_undo` 409s on base mismatch before touching anchors; multi-tab desync structurally blocked by the CAS the finding didn't credit |
| CP-57 | Low | data-integrity noise (DATA-10) | **noise as tagged; META RULING: risky** — the tagger's own rationale is a fix-quality objection (dropping `notes_delete` breaks the pinned `notes_policy_set_is_four_per_command` invariant and relitigates A6); risky > noise. Resolve as rejected-with-rationale, not dropped-as-noise |
| CP-58 | Low | data-integrity noise (DATA-11) | **noise as tagged; META RULING: out-of-scope** — "worth two lines whenever the file is next touched" is deferred future work; out-of-scope > noise |
| CP-59 | Low | observability noise (OBS-7) | **noise** — `op` field already disambiguates; the one high-frequency read op is removed by CP-25's fix |
| CP-60 | Low | observability m (OBS-9) | **material** |
| CP-61 | Low | accessibility m (A11Y-7) | **material** |
| CP-62 | Low | accessibility m (A11Y-8) | **material** (folds into CP-11's fix at zero cost) |
| CP-63 | Low | accessibility noise (A11Y-10) | **noise** — comment-prose accuracy; semantics sound |
| CP-64 | Low | accessibility m (A11Y-11) | **material, with synthesis caveat** — the dismissal gap is real, but the proposed "restore on keyboard closes only" carve-out conflicts with A10's ratified "restored on every close"; needs human reconciliation, not silent adoption |
| CP-65 | Low | accessibility m (A11Y-12) | **material** |
| CP-66 | Low | ux m (UX-13) | **material** (meta: weakest ux tag — material survives mainly on the hardcoded-⌘ half) |
| CP-67 | Low | ux m (UX-15) | **material** (meta: earns it by composition with CP-1) |
| CP-68 | Low | ux m (UX-16) | **material** (meta: same — first cut candidates if scope tightens: CP-66/67/68) |
| CP-69 | Low | ux m (UX-17) | **material** |
| CP-70 | Low | ux m (UX-18) | **material** (tagger explicitly considered and rejected out-of-scope) |
| CP-71 | Low | performance m (P-8) | **material (weak)** — accept-and-record is a sufficient resolution; co-resolve with CP-8 |
| CP-72 | Low | performance noise (P-9) | **noise** — informational by its own declaration; retro learnings line only |
| CP-73 | Low | blast-radius noise (BR-4) | **noise** — checked-clean restated; optional comment |

**CP-level outcome totals (73 CPs):**

| Outcome | Count | CPs |
|---|---|---|
| material | **60** | all not listed below |
| risky | 2 | CP-23, CP-30 |
| out-of-scope | 2 | CP-48, CP-50 |
| noise | 9 | CP-51, CP-55, CP-56, CP-57, CP-58, CP-59, CP-63, CP-72, CP-73 |

After the meta-reviewer's tie-break rulings: CP-23 → material (**61 material**),
CP-57 → risky, CP-58 → out-of-scope; final shape 61 material / 2 risky
(CP-30, CP-57) / 3 out-of-scope (CP-48, CP-50, CP-58) / 7 noise.

Both Criticals (CP-1 autosave data loss, CP-2 unstyled note surface) and all
12 Highs (CP-3..CP-14) are unanimous material — no high-severity finding drew
any dissent tag anywhere.

## Safety carve-out

Protected set (panel-1 severity high/critical with category security,
data-loss, or correctness — survive regardless of tags):
**CP-1** (Critical, data-loss), **CP-3** (High, correctness), **CP-4** (High,
data-loss), **CP-5** (High, security), **CP-7** (High, correctness).
Borderline-category highs (authn CP-6, session-integrity CP-8, RLS-wall
test-gap CP-9, obs/privacy CP-14) sit outside the strict trio but were all
tagged material by every contributing lane, so the question is moot for each.
CP-2 (Critical) is category ux — outside the carve-out — and also material.

**No carve-out-protected finding was downgraded by tag** (meta verified: every
non-material tag in the panel landed on a low/medium finding).

**Downgrade suggestions logged for retro (not acted on) — one, total:**

| CP | Finding | Lane | Suggestion | Rationale |
|---|---|---|---|---|
| CP-5 | SEC-1 (high/security) | security | high → medium | Exposure is browser disk cache / back-forward on shared devices + future-edge-rule hazard; "not a live leak today" per the finding itself; API-CONTRACT-2 independently sized it medium. Tagger's own counterweight: house doctrine (SECURITY-3) treats the Set-Cookie-replay class as security-mandatory. "A sizing note, not a dispute of the defect." |

Carve-out hygiene: all nine lanes wrote an explicit carve-out section; five
reasoned about category membership explicitly. No lane was unaware.

## Meta-reviewer verdicts (opus)

Per-lane: security **calibrated** · correctness **calibrated** · api-contract
**calibrated** (one soft tie-break question, CP-50) · data-integrity
**calibrated at head, one hard tie-break violation at tail** (CP-57) · ux
**over-lenient by distribution** (18/18 material, zero dissent — treat as
upper bound, not convergence) · accessibility **calibrated** · performance
**sharpest lane** (site of the CP-23 tie-break violation) · observability
**calibrated** (best value-add: the CP-14 leak vector) · blast-radius
**calibrated** (noise-heavy shape is a taxonomy artifact).

Red flags for the synthesizer (full text in `reviews/code-adversarial/meta.md`):

1. ux lane rubber-stamped its distribution — leniency, not negligence; CP-66/67/68 are first cut candidates.
2. CP-47 must NOT resolve as dropped-as-noise — apply the tie-break at CP level (material).
3. CP-23's double-risky suppresses a conceded-real defect — resolve material with the split fix; record the generated-column rejection verbatim.
4. CP-57 is risky mistagged noise (resolve rejected-with-rationale); CP-58 is out-of-scope, not noise.
5. BR-5/6/8 verified-clean entries are noise-tagged only because the taxonomy lacks a "clean" tag — route to the audit record, not the retro noise aggregate (BR-6's kill-switch verification is deploy-relevant). Taxonomy gap → retro protocol improvement.
6. Both out-of-scope tags need a concrete home: CP-48 (issue/retro rec) and CP-50 (plan note minimum — one-line fix on a ratified contract).
7. CP-64's proposed fix conflicts with A10's ratified restore-on-every-close wording — incorporate the dismissal gap; reconcile restore semantics with a human.
8. Systematic bias: panel-2 functioned more as verification than rebuttal (85% material; 10 of 15 dissents concentrated in data-integrity/performance/blast-radius). Consistent with a genuinely strong panel-1, but real pressure was applied in only a third of the lanes.
9. Two net-new panel-2 contributions must survive conversion: the CP-14 `base_updated_at` → 22P02 echo vector (observability) and the CP-53 `slice(0, 6)` reproducibility strengthening (correctness) — both belong in their CP's fix note and fixtures.
