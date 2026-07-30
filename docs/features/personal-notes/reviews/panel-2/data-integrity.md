# Panel-2 adversarial review — DATA-INTEGRITY (personal-notes)

Every line-level evidence claim was re-verified against the repo before
tagging (setup-readonly-role.sql, smoke-notes-rls.mjs, notes.routes.test.ts,
search.ts, setup-triggers-and-rls.sql, schema.ts, migrate-user-roles.mjs).

| ID | Tag | Rationale (≤25 words + evidence) |
|---|---|---|
| DATA-1 | material | Verified: setup-readonly-role.sql:16 auto-grants SELECT via default privileges; smoke D3 probe skips without ADMIN_DATABASE_URL (smoke-notes-rls.mjs:141-143). D3's headline guarantee ships false without REVOKE. |
| DATA-2 | material | FK checks do bypass RLS (Postgres semantics); smoke has no B-anchors-A's-note probe (verified, note_id appears only in A's flows). Fix is declarative, no trigger — cheap even at this scale. |
| DATA-3 | material | Verified: notes.routes.test.ts:84 pins F8 through a mock, the exact Learnings anti-pattern; D5 anchor fetch has no deleted-awareness, so ghost dots violate F8 as the plan itself specifies it. |
| DATA-4 | material | Verified: smoke-notes-rls.mjs:10-11 assumes auth.users cascade, :66-71 inserts without owner_id — harness already depends on FK + DEFAULT auth.uid() that D2 never declares. Genuine spec/harness contradiction. |
| DATA-5 | material | Verified house idiom: schema.ts gives every table a named idx_* set incl. GIN on each searched tsvector. Proposed set maps 1:1 to the plan's three queries; omissions recorded. Zero-cost at CREATE. |
| DATA-6 | material | Verified: search.ts:322 and setup-triggers-and-rls.sql:5,17 all pin 'english'; GENERATED tsvector forces an explicit config choice. Mismatch fails silently as bad recall — pin costs one line. |
| DATA-7 | material | tsvector 1MB engine cliff is real though it takes a multi-MB paste; unbounded user-writable column with no server 400 is the actual gap. Plan's own D2 kind-CHECK sets the CHECK precedent. |
| DATA-8 | material | Verified: zero `.schema("lumen")` usage in apps/web today; smoke:67 assumes it works. Exposed-schemas is dashboard config, not SQL — textbook works-locally/PGRST106-in-prod drift. Idiom list matches migrate-user-roles.mjs exactly. |
| DATA-9 | risky | Verified: no updated_at trigger exists to reuse. But owner-only RLS already contains any anchor-UPDATE harm; this is free least-privilege hygiene while writing the migration, not load-bearing. |
| DATA-10 | risky | Retention concern legitimate, but the fix as written ships user-facing copy promising 30-day purge with no purge job — a false promise is worse than silence. Column COMMENT alone is fine. |

## Stance

This panel-1 review is unusually well-evidenced: every specific claim I
checked — the default-privileges auto-grant, the skippable D3 probe, the
mock-pinned F8, the smoke script's undeclared FK/default dependencies, the
'english' config uniformity, the absence of any PostgREST-into-lumen path —
held up exactly as cited, so the material density is earned, not deference.
The two risky tags are where the review over-reaches its lens: DATA-9 is
free hygiene dressed as a finding, and DATA-10's remedy would ship a
user-facing purge promise the system doesn't keep. DATA-1, DATA-3, and
DATA-8 are the three that would otherwise ship as latent production defects
(void isolation guarantee, ghost dots/leak-class filter, PGRST106 env
drift) and must reach the migration spec.
