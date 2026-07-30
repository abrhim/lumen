# Panel-2 adversarial review — security (personal-notes)

Citations spot-checked against source. Verified: setup-readonly-role.sql:14–16,
migrate-user-roles.mjs:88–106, setup-triggers-and-rls.sql:29–47,
smoke-notes-rls.mjs:53,69,103–140, auth.server.ts:22–27,
search-ui/bugs.md B4, search.ts:556–584 (buildLegs), :679, :690,
search-request.server.ts:36–46, notes-harness.test.ts:7–24,
notes.routes.test.ts:26–35,82–89, notes-search-merge.test.ts (no hostile-q
or type fixture — grep empty).

| ID | Tag | Rationale (≤25 words, with evidence pointer) |
|----|-----|----------------------------------------------|
| SEC-1 | material | Verified: app_users is postgres-owned `security_invoker=false` over auth.users (migrate-user-roles.mjs:88–106); `.schema("lumen")` forces exposure+grants. Minor miss: word_tags/strongs_lexicon DO have RLS (ingest-strongs.mjs:331–332). |
| SEC-2 | material | Verified: setup-readonly-role.sql:16 default-privileges auto-grant fires on CREATE by same admin role; D3's headline is false without explicit REVOKE. Sharp catch. |
| SEC-3 | noise | Falsified by PG semantics: absent WITH CHECK, USING governs new rows on UPDATE/ALL policies (CREATE POLICY docs) — reassignment blocked in every plausible shape. Specialist's own hedge admits it. |
| SEC-4 | material | Verified: FK checks run as table owner, bypassing RLS — forged cross-owner anchors land. Composite FK fix is one line, structural, prevents owner_id drift. |
| SEC-5 | material | Verified: D2 has no auth.users FK; smoke header (lines 9–11) claims a cascade the script hard-deletes around (line 122). Worst lifecycle outcome for this data class. |
| SEC-6 | material | Verified: B4 (bugs.md:41–46) shipped despite review, identical mode; notes.routes.test.ts:26–30 mocks bare Headers, asserts nothing. Known recurring class, now on write paths. |
| SEC-7 | material | Verified: searchAll defaults scope=[...GROUP_KEYS] (search.ts:679), groups=scope.map (:690) — signed-out gains empty notes group, breaking F2 byte-compat. buildLegs silently skips (no 500). |
| SEC-8 | material | Verified: no bound in D2; tsvector ~1MB hard limit turns a big paste into opaque 500. One CHECK constraint; correctly calibrated low. |
| SEC-9 | material | Verified: canon uses websearch_to_tsquery (search.ts tsq); supabase-js textSearch defaults to plain to_tsquery; no type/hostile fixture in notes-search-merge.test.ts. One-word fix. |
| SEC-10 | material | Verified: routes test mocks getNote null (notes.routes.test.ts:82–89) so uuid-shape path untested; F8 pins 404 not 500. Title-strip half is thinner but cheap. |

## Overall stance

Mostly signal — this is an unusually strong panel-1 review: nine of ten
findings survive citation-level verification, evidence pointers hold, and
severity is calibrated to the stated scale rather than enterprise defaults.
SEC-2 (default-privileges auto-grant silently defeating D3) and SEC-6 (a
documented recurrence of shipped bug B4) are the standouts. The one
overreach is SEC-3, whose headline attack is blocked by PostgreSQL's own
USING-as-WITH-CHECK default; its residual value (pin policy shape, DEFAULT
auth.uid()) is spec hygiene the smoke script would catch red anyway.
