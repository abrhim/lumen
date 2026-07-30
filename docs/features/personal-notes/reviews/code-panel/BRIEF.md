# Code-panel brief — personal-notes (step 9)

You are ONE specialist on a nine-role code-review panel for the
personal-notes feature in /Users/abram/code/lumen (branch
feature/personal-notes). Your role is given in your task prompt.

## What to review

The IMPLEMENTATION, not the design. Steps 0–7 (plan, red-first harness,
two review panels, synthesis, human gate) are done; the design decisions
in `docs/features/personal-notes/plan.md` — amendments A1–A19, the
Decisions ledger, the gate rulings, and the in-session ratifications
recorded in `## Pipeline status` (PG-level tombstone invisibility +
DEFINER soft-delete; harness-revision 1) — are SETTLED. Do not re-litigate
them. Your job: does the code correctly and safely implement them, and
what implementation-level defects exist?

Read, in order:
1. `docs/features/personal-notes/plan.md` — amendments + pipeline status.
2. The diff: `git diff $(git merge-base main HEAD)..HEAD` (run `--stat`
   first; read full files where your role needs depth).
3. Key files by area: packages/scripture/src/{search-types,search,notes-refs}.ts;
   apps/web/app/lib/{notes.server,notes-derive,notes-render.server,
   notes-markdown-config,notes-canonical.server,notes-enabled,
   escape-registry,search-request.server,search-obs.server}.ts;
   apps/web/app/components/editor/*; apps/web/app/routes/{notes,notes.$id,
   scripture,search,api.search,media}.tsx; scripts/{migrate-notes,
   smoke-notes-rls,check-notes-bundle}.mjs; apps/web/e2e/*.

## Scale context (avoid enterprise noise)

Single-digit DAU today. Personal devotional data (privacy > uptime).
Cloudflare Workers runtime (no Node APIs at runtime, bundle limits,
per-request I/O). Supabase session-pool cap 15. One developer.

## Ground rules

- Implementation findings only. If you believe a SETTLED decision is
  actively dangerous as implemented, you may flag it, but label it
  `challenges-settled-decision` and expect the bug filter to weigh it
  against the human ruling.
- Every finding: severity (critical/high/med/low), category, file:line,
  a falsifiable claim, and a concrete proposed fix.
- Read the actual code before claiming. Cite line numbers.
- The harness (5 vitest files + smoke-notes-rls.mjs + e2e) is green; a
  finding that contradicts a green test needs to explain the gap.

## Output

Write your findings to
`docs/features/personal-notes/reviews/code-panel/<your-role>.md`.
If that file already exists and is non-empty, STOP — another run owns it.
Format: `## <ROLE>-<n>: <title>` sections with Severity / Category /
File / Claim / Proposed fix. End with a `## Summary` line: counts by
severity. If you find nothing in your lane, say so explicitly — an empty
lane is a real result. Soft time target: 5 minutes of focused review.
