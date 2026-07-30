# Handoff prompt — personal-notes, step 8

Paste everything below the rule as the first message in the new session.

---

Continue the personal-notes feature in /Users/abram/code/lumen. You are mid-flight
in the feature-workflow skill (.claude/skills/feature-workflow/SKILL.md) — invoke
it, but do NOT restart the pipeline: steps 0–7 are complete and committed. Read,
in order:

1. docs/features/personal-notes/plan.md — the governing document. It contains the
   original plan, panel amendments A1–A19, the ## Decisions ledger, the hashed
   ## Drift baseline, and a ## Pipeline status marker confirming the human gate is
   CLOSED with all rulings ratified. Trust the amendments over the original D1–D7
   where they conflict.
2. docs/features/personal-notes/panel-1.md — 56 canonical review findings and the
   binding harness-gap backlog (items 1–53).
3. The red harness: packages/scripture/src/__tests__/notes-harness.test.ts,
   apps/web/app/lib/__tests__/notes-markdown.test.ts,
   apps/web/app/lib/__tests__/notes-render.test.ts,
   apps/web/app/lib/__tests__/notes-search-merge.test.ts,
   apps/web/app/routes/__tests__/notes.routes.test.ts,
   scripts/smoke-notes-rls.mjs.

You are at STEP 8 — IMPLEMENT, on branch feature/personal-notes. The harness is
red-first by design (docs/features/personal-notes/harness-initial.log is the
proof); your job is to turn it green without weakening it. Hard rules:

- Human rulings are settled — do not re-open: raw ProseMirror (no TipTap/CodeMirror),
  markdown storage with the canonical-form invariant C(md), GROUP_KEYS FROZEN
  (notes is a route-layer key via SEARCH_RESPONSE_KEYS), autosave REQUIRED
  (3s debounce, loud failure, buffer never lost), ⌘K Shape C (context sets the
  verb: Enter inserts in-editor, ⌘Enter navigates; Cmd+J retired), dots ratified
  (hollow ring, first slot, mobile clamp 4; ALL dot colors through theme tokens —
  user-configurable palette is a planned follow-up), transcript anchors are
  episode@t_start_s (the #seq shape must be rejected), soft-delete enforced at
  RLS, Playwright e2e in scope.
- Implementation cap: 3 attempts, then halt with blocked.md per the skill.
- Harness edits only via explicit harness-revision (re-runs panel-1). Verify
  plan/harness hashes against ## Drift baseline at step-8 exit (hash recipe is
  written next to the hashes).
- Verification always uses tsc -b --force (stale-cache false-greens are a known
  repo failure).
- Migration runs against the admin DSN in the repo-root .env; smoke-notes-rls.mjs
  hard-requires ADMIN_DATABASE_URL. The Supabase exposed-schemas config change is
  a manual dashboard step — see A6 and the deploy checklist in A16.
- Before ANY deploy: git log HEAD..main must be empty (concurrent-session hazard
  is memorialized), and deploys go DB → Supabase config → worker.
- After implementation: steps 9–15 (code-panel, code-adversarial, bug filter,
  repro tests, fix, retro, validate --done) per the skill. Spawn panel agents in
  parallel; each writes its own review file incrementally.

House style is binding: no AI-UX dialect, typography-first, registers print
nothing when empty, motion-safe: variants only, WCAG AA floors. When a genuine
fork appears that the plan doesn't answer, ask Abram — otherwise proceed
autonomously.
