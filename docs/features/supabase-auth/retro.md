# supabase-auth — retro

**Tier**: large. **Gates**: human 1b+7 waived by Abram ("go all the way until it is done"). **Shipped**: f8267a7, deployed aee6080a, live-verified.

## Plan accuracy
Strong. The two pre-plan probes (auth settings + JWKS) settled the single biggest architecture question (local ES256 getClaims → zero-network root loader, COR-2) before a line was written — same pattern that paid off in strongs/art-graph. The plan's own guesses that panels overturned: (a) "token_hash template edit not automatable" → half-true (Management API exists but no PAT in repo, so still human-gated); (b) a "1.5s timeout" degrade wrapper the plan implied → adversarial proved it would CREATE a session-death bug (abandoning a mid-flight refresh), reversed to no-timeout. Net: the plan was a good scaffold; the panels earned their cost on protocol mechanics the plan couldn't have known.

## Panel signal
- **Plan-stage (3+2)**: security caught the would-ship-broken PKCE-verifier commit (login action must return Set-Cookie) at PLAN stage — highest-value single finding. Product-adversarial reframed the whole risk model: not "hollow auth" but "silent sign-out via dropped rotation" → added H6. Dissent rate healthy: UX dissented on fixed-chrome sign-in (adopted), product REFUTED its own deep-link attack (self-correcting).
- **Code-stage (3+3)**: the safeReturnTo backslash open-redirect was a genuine CRITICAL the harness never would have caught (the D7 test only covered `//` and `https:`). Independent convergence: cooldown bug found by 2 reviewers, then a 3rd (adversarial) proved the *panel's own recommended fix* was broken (regex ate hyphen slugs). That's the tske "verify your verifiers" lesson recurring — the fix needs adversarial review as much as the code.
- Provenance histogram: 6 confirmed bugs — security 2, platform 2, ux 2; adversarial upheld 6/6 with executed evidence, refuted 0, corrected 1 fix. Zero panel false-positives survived to code.

## Harness coverage
H1–H6 (23 tests) held. H6 (rotation-commit) earned itself immediately: the B6 fix (move construction into try) regressed H6 by returning fresh Headers in the catch — the test caught the dropped-rotation-cookie the same hour it was written. tske B2 (happy-path assertions both directions) applied to H5 and paid: the degrade test AND the success test both assert, so a never-throw wrapper can't silently pass while broken.

## Wasted effort
Minimal. The plan's `?code=`-primary framing (later demoted to fallback under token_hash) meant the confirm route carries both paths — not waste, it's the correct robustness given we can't script the template edit. One genuine over-reach: plan spec'd a `?next=` open-redirect analysis that D14 then cut — but that analysis is why safeReturnTo existed to be attacked, so arguably load-bearing.

## Recommendations
1. **A recommended fix is not a verified fix.** Both a plan-panel and a code-panel proposed concrete fixes (the getClaims timeout; the safeReturnTo regex) that adversarial review proved wrong. Code-adversarial should always re-run the panel's *proposed remedy* against the same vectors, not just confirm the bug.
2. **Probe the deploy target's live state, not just its API.** The adversarial live-probe found the Site URL is literally unset today (links → localhost:3000). Auth features should curl the real redirect behavior during planning — a settings-endpoint check said "email on" but not "redirects go nowhere useful."
3. **Framework header-merge semantics deserve a source citation in the plan, not a test.** The RR7 redirect-drops-root-headers behavior is invisible to unit tests (our routes self-carry headers by luck of structure); it's now a code comment invariant. Future stacks: verify the framework's header-on-redirect behavior at plan time.

## Provenance histogram
- security: 2 confirmed (backslash open-redirect CRIT, login-CSRF MED) + 1 plan-stage would-ship-broken (verifier commit)
- platform: 2 confirmed (cooldown re-arm, never-throw env gap) + 1 advisory (RR7 header-drop invariant)
- ux/theme: 2 confirmed (Radix sign-out no-op, --destructive ink contrast)
- adversarial: upheld 6/6 with executed evidence, refuted 0, corrected 1 proposed fix
- convergence: cooldown ×2 reviewers; "the fix is broken" ×2 adversarial
- reversals: 1 (getClaims timeout removed)

## Quality signals
- plan-stage dissent: healthy (UX self-adopted, product self-refuted one attack)
- code-stage yield: 6 real bugs, 1 CRITICAL harness-invisible, 0 false-positives to fix
- convergence events: 2 (cooldown ×2 reviewers; fix-is-broken ×2 adversarial)
- reversals: 1 (getClaims timeout — plan → panel → adversarial confirmed removal)
- probe ROI: 2 pre-plan probes each collapsed a major open question

```json
{
  "feature": "supabase-auth",
  "tier": "large",
  "gates_waived": ["1b", "7"],
  "panels": { "plan": [3, 2], "code": [3, 3] },
  "bugs_confirmed": 6,
  "bugs_critical": 1,
  "harness_invisible_bugs": 1,
  "false_positives_to_fix": 0,
  "adversarial_upheld": 6,
  "adversarial_refuted": 0,
  "adversarial_fixes_corrected": 1,
  "convergence_events": 2,
  "reversals": 1,
  "preplan_probes": 2,
  "tests_added": 27,
  "commits": ["8d69537", "b643bd2", "f8267a7"],
  "deployed": "aee6080a"
}
```
