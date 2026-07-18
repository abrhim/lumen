# Panel 2 (adversarial) — Pipeline Reliability + Cost (unshaken-ingest A1)

Re-tagging panel-1's REL-1..REL-8. Calibration: solo-dev, manual runs, ~0
users, no orchestration. Evidence from plan.md, design/media-collections.md,
the harness, and a live `yt-dlp --help` check (v2026.07.04, installed).

| ID | Tag | Rationale (≤25 words, with evidence) |
|---|---|---|
| REL-1 | material | `validateUtterances` (test L155-167) never cross-checks last-end against episode `durationS` (present, L188); silent truncation passes — violates plan's own strongs completeness lesson (L145). |
| REL-2 | noise | yt-dlp `.part` is DEFAULT (help: `--no-part` is the opt-out; `-c` resumes partials) — killed download leaves `.part`, final name appears only post atomic-rename. Fix redundant. |
| REL-3 | material | Probe 5 verified pricing only (L43-45); sync-vs-async upload of the 6.1h/~500MB Numbers file unverified. Real gap on load-bearing episodes; probe-largest-first is cheap. Exact Deepgram limit unverifiable here. |
| REL-4 | risky | discover re-run undefined (test L113-123 = purity only); a weekly CFM upload mid-run could re-rank and drop a paid episode. Mitigated: episodes.json committed/reviewable (L73). Low-prob, recoverable. |
| REL-5 | noise | Cost immaterial: $200 non-expiring credit, NO card, ~$20 est = 10x headroom (probe 5); disk-cache prevents re-cost (design L125). Reconciliation is nice-to-have observability, not risk. |
| REL-6 | risky | Q5 self-flags keyterm limit unknown (L168-170); harness has no cap test (`buildDeepgramRequest`, L149-153). Oversized list wastes a large upload → 400. Client-side cap cheap; already acknowledged. |
| REL-7 | noise | 2-3GB on a solo-dev laptop is trivial; disk-full fails loudly via yt-dlp (leaves `.part`); retention is a doc preference, not a risk. Manual run. |
| REL-8 | risky | Nil impact today (panel verified: no live public reader). But default-true fails OPEN — search/graph before B could surface an un-readable collection. public=false is fail-safe, cheap; forgotten-flip self-corrects at B. |

REL-2 evidence detail: `yt-dlp --help` shows `--part  Use .part files instead
of writing directly` paired with a `--no-part` opt-out, and `-c/--continue
Resume partially downloaded files/fragments` — both confirm `.part` +
atomic-rename-on-success is the default. Panel-1's premise ("leaves a truncated
`<id>.m4a` that skip treats as done") is false under defaults: a killed
download leaves `<id>.m4a.part`, and the final `<id>.m4a` only exists after a
clean exit, so any "final artifact exists ⇒ skip" check is safe for free. The
only caveat is one line — don't pass `--no-part` — which the plan/harness never
do.

Overall stance: Panel-1's three Highs do not all survive adversarial re-check —
REL-2 is neutralized by yt-dlp's default `.part`/atomic-rename behavior, while
REL-1 (no transcript-coverage assertion) and REL-3 (unverified multi-hour
upload path) are the genuine reliability gaps worth closing before the ~$20/44h
costed run. The cost/disk findings (REL-5, REL-7) are immaterial given the $200
non-expiring, no-card credit and a solo-dev laptop; REL-4/6/8 are cheap
fail-safe hardening against real-but-low-probability footguns rather than
must-fixes. Net: two material, three risky, three noise.
