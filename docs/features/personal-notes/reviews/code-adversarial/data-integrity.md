# PANEL-2 ADVERSARIAL — data-integrity lane

- **Lane:** data-integrity (panel-1 findings DATA-1..DATA-11)
- **Date:** 2026-07-30
- **Tagger role:** panel-2 adversarial, data-integrity lane
- **Method:** every finding re-verified against the cited code
  (scripts/migrate-notes.mjs, scripts/smoke-notes-rls.mjs,
  apps/web/app/lib/notes.server.ts, apps/web/app/routes/notes.$id.tsx),
  keyed to code-panel.md CP numbers, checked against plan.md settled
  decisions (A1-A19, gate rulings, harness-revision-1 ratification).

## Tags

| ID | CP | Tag | Rationale (evidence-based) |
|----|----|-----|----------------------------|
| DATA-1 | CP-9 | material | Verified: smoke-notes-rls.mjs:153-160 asserts only the owner happy path on the RPC. The migration invariant `soft_delete_rpc_definer_and_anon_locked` (migrate-notes.mjs:319-327) checks only EXECUTE privileges and `prosecdef` — if `owner_id = auth.uid()` were dropped from the function WHERE (migrate-notes.mjs:156-159), both smoke and invariants stay green while any authenticated user deletes any note by uuid. The one hand-written predicate that IS the wall has no adversarial probe. Concede in full. |
| DATA-2 | CP-3 | material | Verified: notes.$id.tsx:208-221 — `updateNote` commits, then `syncNoteAnchors` runs unprotected; a throw lands in the blanket catch at :353-356 → 500 after a committed write. Client's `base_updated_at` is now stale → next save takes the 0-row path in updateNote (notes.server.ts:266-268) → self-inflicted 409. Divergence (wikilink in body, no anchor row) confirmed; capture-only notes never reopened stay divergent. The 200-with-`anchors_degraded` fix is proportionate. |
| DATA-3 | CP-16 | material | Verified: syncNoteAnchors (notes.server.ts:287-296) is N sequential DELETEs then one upsert — delete-first means mid-loop failure is anchor LOSS. append (notes.$id.tsx:269-276) passes a route-time snapshot to a function that re-reads internally (:282) and computes `toDelete = existing − want`: an anchor added by another tab in that window is deleted, and anchor writes are not CAS-guarded (only body writes are). The single-row-upsert fix is simpler than the current code, not heavier — no risky tag applies. |
| DATA-4 | CP-28 | material | Verified: GRANTS_SQL line 200 is table-wide `SELECT, INSERT, UPDATE`; notes_insert WITH CHECK is owner-only (migrate-notes.mjs:110-111). Born-dead INSERT is real: `Prefer: return=minimal` reads nothing, so the tombstone-hiding SELECT policy never engages; the trigger is BEFORE UPDATE only, so INSERT can also set arbitrary `updated_at`/`created_at`. Checked the fix for breakage: app code writes only body_md (updateNote :250, create RPC :177 inserts only body_md; defaults need no column privilege), and the smoke's forge/reassign probes still pass under 42501-instead-of-0-rows. Column-scoped grants are sound and cheap. |
| DATA-5 | CP-29 | material | Verified: the 15-entry INVARIANTS array (migrate-notes.mjs:216-328) contains no pg_indexes or pg_attribute check; the "exactly these four objects" pin (:73-77) lives only in a comment, and the partial predicates are load-bearing for RLS-qual index eligibility. `getChapterNoteAnchors` hard-codes `notes(title_line)` (notes.server.ts:171) — a runtime dependency with no invariant. A16 binds this migration to "named invariants (exit 2 on violation)"; the finding applies the repo's own convention, and self-moderates the brittle pg_attrdef-contains-120 variant. |
| DATA-6 | CP-20 | material | Verified byte-for-byte: `check("CF-9: …", true, …)` at smoke-notes-rls.mjs:185 passes a literal `true`; the queried `defaultAcl` rows go only into the detail string. An assertion that cannot fail in the security smoke corrupts the meaning of "PASS 19/19" — and GRANTS_SQL alters default privileges for FUNCTIONS only (:208), never tables, so the lumen_read table auto-grant the line pretends to cover is genuinely still armed (SEC-3's half of CP-20). Demote-or-realify is a one-line honesty fix. |
| DATA-7 | CP-54 | material | Verified: smoke creates via raw `.insert()` + separate anchor insert (:74-87); the app creates via the RPC (notes.server.ts:215-221). Statement-shape fidelity is the ratified rationale of harness-revision-1 — the finding extends the same principle to create. The plpgsql-atomicity probe partially tests Postgres itself, but the double-soft-delete→0 pin (the app maps 0→404, notes.$id.tsx:344-345) and the bogus-kind rollback probe guard the two highest-risk objects in the schema. Keep the raw-insert probes too (the grant surface makes raw PostgREST a real path); add, don't replace. |
| DATA-8 | CP-55 | noise | Overreached. Today's append cannot reach the tombstone-anchor insert: soft-delete bumps `updated_at` via the BEFORE UPDATE trigger, so the CAS at notes.$id.tsx:259-263 fails (base mismatch + `deleted_at` guard) and returns before any anchor write (:264-268). The residual window (delete committing between a successful CAS and the anchor statement) is milliseconds, self-inflicted, and produces rows that are invisible (EXISTS clause) and purge-cascaded. The one-line WITH CHECK hardening is fine hygiene but would not change shipped quality. |
| DATA-9 | CP-56 | noise | Refuted on the stale-flag half: `append_undo` 409s on `note.updated_at !== base` (notes.$id.tsx:307-309) BEFORE touching anchors, and no code path writes anchors without bumping `updated_at` (syncNoteAnchors is only ever called after updateNote), so a flag from the immediately-preceding append is fresh whenever the anchor removal runs — the multi-tab desync scenario is structurally blocked by the CAS the finding didn't credit. What remains is a user forging a form field to desync dots on their OWN note: trust-boundary purism, not a defect that changes shipped quality. |
| DATA-10 | CP-57 | noise | Refuted: the "no other tripwire" claim is false — `authenticated_exact_grant_shape` (migrate-notes.mjs:252-262) asserts the notes grant array equals exactly `['INSERT','SELECT','UPDATE']`, so the hypothesized accidental `GRANT DELETE` fails invariants with exit 2 on the next run, the same detection story as every other hand-applied drift. The primary fix (drop notes_delete) relitigates A6's ratified four-explicit-per-command-policies style and would break the pinned `notes_policy_set_is_four_per_command` invariant. The `deleted_at IS NULL` USING variant is harmless but guards an already-tripwired path. |
| DATA-11 | CP-58 | noise | Claim verifies structurally (makeUser calls at :69-70 sit outside the try; sequential awaits in finally :201-202 can skip b.cleanup) but the impact is overstated: a leaked user's password is a `crypto.randomUUID()` known to no one after process exit and no session persists (`persistSession: false`), so "real notes-table write ability" is not exercisable — the residue is inert `@example.invalid` rows in auth.users. Promise.allSettled cleanup is correct practice and worth two lines whenever the file is next touched, but it does not change shipped quality. |

## Carve-out downgrade suggestions

none — DATA-1 (severity high, security-boundary) is the only carve-out
candidate in this lane and it verifies in full; no downgrade suggested.

## Overall stance

Mostly signal. Seven of eleven findings verified line-for-line against the
code and earn material — the specialist is precise on grants, atomicity
windows, and harness honesty (DATA-1/2/3/4 are exactly the class this lane
exists to catch, and the hardcoded-pass catch in DATA-6 is byte-verifiable).
The noise concentrates in the low-severity tail, where the specialist did
not credit existing defenses: the base-CAS ordering blocks DATA-9's real
scenario, the exact-grant-shape invariant already tripwires DATA-10, and
DATA-8/11 are races or residues with no exercisable impact.
