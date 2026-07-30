# DATA-INTEGRITY — code panel (step 9), personal-notes

Reviewed: `scripts/migrate-notes.mjs` (DDL, grants, invariants),
`scripts/smoke-notes-rls.mjs`, `apps/web/app/lib/notes.server.ts`,
`apps/web/app/routes/notes.$id.tsx`, against plan.md A5/A6/A7/A13/A16 and
the harness-revision-1 ratification (DEFINER soft-delete). Settled decisions
not re-litigated: PG-level tombstone invisibility, DEFINER soft_delete_note,
delete+insert anchor diff as the mechanism (I review its failure windows,
not its existence).

## DATA-1: smoke never probes the DEFINER soft_delete_note cross-user or anon

Severity: high
Category: test-gap / security-boundary
File: scripts/smoke-notes-rls.mjs:153-160

Claim: harness-revision 1 moved the soft-delete security boundary out of RLS
and into the hand-written `WHERE id = p_id AND owner_id = auth.uid() AND
deleted_at IS NULL` of a BYPASSRLS SECURITY DEFINER function
(migrate-notes.mjs:147-163). The smoke script asserts only the happy path
(`a.client.rpc(...) === 1`). There is no `b.client.rpc("soft_delete_note",
{p_id: note.id})` asserting count 0 and note still visible to A, and no anon
RPC probe. Pipeline status says cross-user/anon probes were "verified live"
— but that was a one-off in-session check, not a repeatable assertion. If a
future edit drops `owner_id = auth.uid()` from the function, every existing
smoke check still passes green while any authenticated user can delete any
note by uuid. The one function whose predicate IS the entire wall is the one
statement shape smoke doesn't adversarially test.

Proposed fix: before A's soft-delete, add: (1) B calls
`rpc("soft_delete_note", {p_id: note.id})` → expect `sdCount === 0` and A
still reads the note; (2) anon client calls the RPC → expect error
(EXECUTE revoked). Two checks, ~10 lines, same probe style as F1.

## DATA-2: body-update commits, anchor-sync fails → 500 after a committed write, then spurious 409s

Severity: med
Category: partial-failure / atomicity
File: apps/web/app/routes/notes.$id.tsx:208-221 (update), 259-276 (append); apps/web/app/lib/notes.server.ts:275-308

Claim: in both `update` (sync_anchors=1) and `append`, `updateNote` commits
the body (new `updated_at`), then `syncNoteAnchors`/anchor insert runs as
separate statements. If the anchor step throws, the outer catch returns 500
— but the body write already landed. Consequences: (a) the client believes
the save failed and retries with its old `base_updated_at`, which now
mismatches → 409 "changed elsewhere" for a change the user made themselves
(autosave loop lands in the conflict surface); (b) body/anchor divergence —
the wikilink is in the body but no anchor row exists, so the reader-rail dot
and A5 chapter fetch miss it. The divergence self-heals only on the next
successful editor save with sync_anchors=1; a capture-only note that is
never reopened stays divergent indefinitely.

Proposed fix: two independent mitigations. (1) When the body update
succeeded but anchor sync failed, return 200 with the fresh `updated_at`
plus a `{ anchors_degraded: true }` flag (and keep the `note_write_failed`
log) so the client's LWW base advances and the 409 loop cannot happen.
(2) Close the divergence structurally: see DATA-3.

## DATA-3: syncNoteAnchors is non-transactional replace-set with per-row deletes; append can delete concurrently-added anchors

Severity: med
Category: atomicity / lost-update
File: apps/web/app/lib/notes.server.ts:275-308; apps/web/app/routes/notes.$id.tsx:269-276, 326-336

Claim: the diff runs N sequential DELETE statements then one upsert — a
failure mid-loop leaves a partially deleted set with the inserts never
attempted (delete-first ordering means the failure mode is anchor LOSS, not
anchor surplus). Separately, `append` uses replace-set semantics for a
single-row addition: it snapshots `getNoteAnchors`, then passes
`[...snapshot, resolved]` to syncNoteAnchors, whose fresh internal read
computes `toDelete = existing − want` — any anchor added by another tab
between the route's snapshot and the sync's read is deleted. Body writes are
CAS-serialized (base-echo) but anchor writes are not, so the window is real
in multi-tab use. Same shape in `append_undo` (removal via full-set
rewrite).

Proposed fix: (1) `append` should not use replace-set at all — one
`.upsert([{note_id, kind, ref_id}], {onConflict, ignoreDuplicates})` of the
single new row; `append_undo` one targeted `.delete().match(...)`. That
removes the concurrent-deletion window from both capture paths and shrinks
DATA-2's window to one statement. (2) For the editor's full diff, either
batch `toDelete` into one statement (`.or()` chain over
kind/ref_id pairs under the note_id eq) or add a
`sync_note_anchors(p_note_id, p_anchors)` SECURITY INVOKER RPC in the A7
mold so the diff is one transaction. At current scale (1) matters, (2) is
cheap insurance.

## DATA-4: column-unscoped INSERT/UPDATE grants on notes allow timestamp and tombstone tampering on own rows

Severity: med
Category: constraint-gap / grants
File: scripts/migrate-notes.mjs:200 (GRANTS_SQL); policies 106-118

Claim: `GRANT SELECT, INSERT, UPDATE ON lumen.notes TO authenticated` is
table-wide. The notes policies check only ownership + liveness, so an
authenticated user can, on their own rows, via PostgREST directly:
(a) INSERT or UPDATE arbitrary `created_at` (breaks any future
audit/ordering trust in that column); (b) INSERT a born-dead row
(`deleted_at` pre-set) — the SELECT-policy NEW-row check that blocks
tombstone UPDATEs applies "whenever the statement reads the table"; a bare
INSERT with `Prefer: return=minimal` reads nothing, so nothing but the
INSERT WITH CHECK (owner-only) gates it, producing rows invisible to
everyone that still count against storage and dodge the app entirely;
(c) attempt `updated_at` writes (currently repaired by the trigger — but the
trigger is ordering-load-bearing for LWW, and the grant is the wall that
should exist anyway). App code never writes any of these columns: the create
RPC inserts only `body_md` (defaults need no column privilege), updateNote
updates only `body_md`, soft-delete is the DEFINER RPC.

Proposed fix: replace with `GRANT SELECT ON lumen.notes TO authenticated;
GRANT INSERT (body_md), UPDATE (body_md) ON lumen.notes TO authenticated;`
and update the `authenticated_exact_grant_shape` invariant to assert the
column-level shape (information_schema.column_privileges). Leave
note_anchors table-wide (create RPC writes owner_id explicitly, and the
composite FK + WITH CHECK already pin it).

## DATA-5: the four-object index pin and title_line contract have no invariant — the pin lives only in a comment

Severity: med
Category: invariant-gap / drift
File: scripts/migrate-notes.mjs:73-83, 57-58, 216-328

Claim: the DDL declares "Indexes: exactly these four objects" with
deliberate omissions (DATA-5 of panel-1) and partial predicates that are
only correct because they match the RLS-injected `deleted_at IS NULL` qual —
but none of the 14 invariants checks pg_indexes. A hand-applied index, a
dropped partial predicate, or a failed `CREATE INDEX` on re-run is
invisible to `COMMIT=1` exit-code 2. Likewise the `title_line` generated
column (the recorded A5 deviation — the reason chapter fetches never ship
bodies) has no invariant pinning existence, generatedness, or the ≤120
bound, even though `getChapterNoteAnchors` (notes.server.ts:171) hard-codes
`notes(title_line)` and would fail at runtime if the ALTER ever silently
drifted.

Proposed fix: two invariants. (1) `index_set_is_exactly_pinned`: `SELECT
array_agg(indexname ORDER BY indexname) = ARRAY[...six names incl. both
pkeys...] FROM pg_indexes WHERE schemaname='lumen' AND tablename IN
('notes','note_anchors')`, plus `indpred IS NOT NULL` for the two partials.
(2) `title_line_generated_bounded`: pg_attribute `attgenerated = 's'` for
title_line + a functional probe (`insert`-free: `SELECT
length(left(repeat('x',200),120)) = 120` is pointless — instead check
pg_attrdef's expression contains `120`, or accept existence+generated only).

## DATA-6: smoke's CF-9 default-privilege check is a hardcoded pass

Severity: low
Category: test-gap / tautology
File: scripts/smoke-notes-rls.mjs:181-185

Claim: `check("CF-9: ...neutralized/handled default-privilege
auto-grants...", true, ...)` passes unconditionally — the queried
`defaultAcl` rows are printed as detail and never asserted. The comment
brands it informational, but a check() that cannot fail inflates the
"PASS 19/19" count and visually launders the one CF-9 mechanism
(setup-readonly-role.sql's ALTER DEFAULT PRIVILEGES) that will silently
re-grant lumen_read SELECT on any FUTURE lumen table. The real protection
for the two notes tables is the adjacent zero-grants check, which is fine —
but this line is theater.

Proposed fix: either assert something real — e.g. after confirming the
default ACL still exists, `CREATE TABLE lumen._cf9_probe(); SELECT` grants;
too heavy for smoke — or demote it honestly: log the row count without
calling check(), so the pass-count only counts assertions.

## DATA-7: smoke never exercises the app's create statement shape (create_note_with_anchors RPC)

Severity: low
Category: test-gap / statement-shape
File: scripts/smoke-notes-rls.mjs:74-87

Claim: harness-revision 1's rationale was that smoke must use the app's
real statement shapes — and it now does for soft-delete — but creation is
still probed via raw `.insert()` + separate anchor insert, a path the app
never uses (notes.server.ts:215-221 goes through the RPC). Untested live:
the RPC's one-transaction guarantee (an invalid `kind` in p_anchors must
roll back the note row too), owner-default inside the function, and the
idempotent `ON CONFLICT DO NOTHING`. Also untested: double soft-delete
returns 0 (the app maps 0 → 404; a regression to an error would surface as
a 500).

Proposed fix: create A's note via `a.client.rpc("create_note_with_anchors",
{p_body_md, p_anchors:[...]})`; add one atomicity probe (p_anchors with
`kind:'bogus'` → error AND note count unchanged) and one `soft_delete_note`
second-call → 0 check.

## DATA-8: anchors can be inserted onto the owner's own tombstoned note

Severity: low
Category: constraint-gap
File: scripts/migrate-notes.mjs:129-131 (note_anchors_insert), 67-68 (FK)

Claim: `note_anchors_insert` WITH CHECK requires only `owner_id =
auth.uid()`, and the composite FK bypasses RLS, so a soft-deleted note still
satisfies it. A racing capture (append passes getNote just before another
tab's delete commits; the body CAS then fails, but a direct anchor upsert —
per the DATA-3 fix — or today's syncNoteAnchors would proceed) writes
anchor rows onto a tombstone. They are invisible (EXISTS clause) and will
cascade at purge, so this is hygiene, not leakage — but they are
unreachable garbage no code path can remove before purge.

Proposed fix: extend the WITH CHECK with `AND EXISTS (SELECT 1 FROM
lumen.notes n WHERE n.id = note_id AND n.deleted_at IS NULL)` — the exact
mirror of the SELECT policy's clause; one policy edit, no app change.

## DATA-9: append_undo trusts the client's anchor_was_new flag

Severity: low
Category: integrity / trust-boundary
File: apps/web/app/routes/notes.$id.tsx:326-336

Claim: whether the undo removes the anchor row is decided by
`form.get("anchor_was_new") === "1"` — a client-supplied echo of the append
response. A stale or forged flag desynchronizes body and anchors in either
direction on the user's own note: flag=1 when the anchor pre-existed
deletes an anchor row while `[[ref]]` still appears elsewhere in the body
(dot disappears for a live reference); flag=0 when it was new leaves a
phantom anchor with no wikilink. Self-inflicted only (RLS scopes it), but
the server had ground truth at append time and re-derivation is cheap.

Proposed fix: ignore the flag; after the body restore succeeds, recompute:
delete the (kind, ref_id) row iff the restored body no longer contains any
wikilink resolving to that ref (the route already has resolveAnchorRef and
the restored `prev` in hand).

## DATA-10: dormant notes_delete policy arms future hard-delete, including tombstones

Severity: low
Category: defense-in-depth
File: scripts/migrate-notes.mjs:116-118, 200

Claim: authenticated holds no DELETE grant on notes (correct — app only
soft-deletes), yet `notes_delete FOR DELETE USING (owner_id = auth.uid())`
exists and the policy-count invariant PINS its presence. The pair means a
single future `GRANT DELETE` — e.g. copy-pasted from the anchors grant line
— instantly enables user-initiated hard deletion, and because the USING has
no `deleted_at IS NULL`, it reaches tombstones inside the 30-day window,
violating the CF-36 purge-deadline semantics with no other tripwire.

Proposed fix: either drop the policy (and set the invariant to 3-no-DELETE,
matching the anchors idiom of absent-policy-as-design) or add `AND
deleted_at IS NULL` so an accidental grant can at least never bypass the
purge window. Dropping is cleaner; the grant absence is already
invariant-pinned.

## DATA-11: smoke user cleanup can leak throwaway auth users

Severity: low
Category: test-hygiene
File: scripts/smoke-notes-rls.mjs:69-70, 200-203

Claim: `makeUser("a")` runs outside any try; if `makeUser("b")` then throws
(rate limit, transient), user A is never deleted. In the finally block,
`await a.cleanup()` rejecting skips `b.cleanup()`. Leaked
`smoke-notes-*@example.invalid` confirmed users accumulate in auth.users
with real notes-table write ability.

Proposed fix: create both users inside the try with cleanup handles
registered as acquired, and run cleanups as
`await Promise.allSettled([a?.cleanup(), b?.cleanup()])`.

## Non-findings (checked, clean)

- soft_delete_note predicate completeness: owner + live + id, schema-
  qualified `auth.uid()` under `search_path = ''`; NULL uid matches nothing
  (owner_id NOT NULL); count return leaks nothing (0 for foreign and absent
  alike). Mirrors notes_update USING verbatim as ratified.
- create_note_with_anchors: genuinely one transaction; bad kind/NULL fields
  abort the whole thing (CHECK/NOT NULL); INVOKER + column default make
  owner forgery impossible; ON CONFLICT only reachable for the PK.
- Idempotent re-run: every DDL statement is IF-NOT-EXISTS / OR-REPLACE /
  DROP-IF-EXISTS+CREATE; grants/revokes idempotent; one-tx apply with
  dry-run rollback is sound. (Dry-run exits 0 even when invariants fail, by
  documented design — acceptable, but note it means dry-run cannot serve as
  a drift check; only COMMIT=1 exits 2.)
- Composite-FK forgery wall, FORCE RLS both tables, initplan idiom,
  partial-index/RLS-qual eligibility, generated tsvector config pin, and
  the append_undo byte-restore arithmetic (`slice(0, -(line.length+2))`
  against a canonical trailing-\n body) all check out.

## Summary

critical: 0, high: 1 (DATA-1), med: 4 (DATA-2, DATA-3, DATA-4, DATA-5),
low: 6 (DATA-6 through DATA-11). Total: 11.
