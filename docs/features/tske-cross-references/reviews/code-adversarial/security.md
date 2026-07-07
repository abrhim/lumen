# CODE-ADVERSARIAL / security — tske-cross-references

Adversarial pass against `docs/features/tske-cross-references/reviews/code-panel/security.md`
(CSEC-1..5). Re-read `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `scripts/setup-triggers-and-rls.sql` in full, plus their
siblings (`scripts/migrate-canon-spine.mjs`, `scripts/smoke-canon-spine.mjs`,
`scripts/ingest-phase-a.ts`, `apps/web/app/routes/scripture.tsx`,
`packages/scripture/src/queries.ts`, `scripts/setup-readonly-role.sql`) rather than trusting the
panel write-up.

**CSEC-1 verification.** Confirmed line-accurate: in both scripts, `.env` read → `DATABASE_URL`
extraction → port check → `postgres()` client construction all run before the `try {}` that ends in
`catch (err) { ...scrub(err.message)... }`. Checked the "mirrors pre-existing gap" claim against
both true siblings rather than accepting it: `smoke-canon-spine.mjs:11-17` has the *identical*
unwrapped pattern — `smoke-openbible.mjs` is a faithful structural copy, claim holds there.
`migrate-canon-spine.mjs` is different: its `main()` wraps exactly this step (`loadAdminUrl()` +
`postgres(...)`) in its own `try { ... } catch (err) { log(...scrub(err.message)...); }`
(`:168-176`). So `ingest-openbible-refs.mjs` does *not* mirror its nearest sibling — it drops a
protection that sibling already has. The panel's softening framing is half-true and, if anything,
undersells the ingest-script instance.

**CSEC-2 verification.** Confirmed: `data/openbible/README.md` records source URL, download date,
and license, but no hash. Confirmed the file is gitignored (`git check-ignore -v` hits `.gitignore:14
data/`) — not version-controlled, so there's no independent commit-history integrity trail either.
Weighed against actual blast radius: ingest already has a structural tripwire independent of any
checksum — `UNMAPPED_CAP` aborts the whole run (exit 1, no commit) if >0.5% of source rows fail to
parse/resolve (`ingest-openbible-refs.mjs:23,177-180`), and `smoke-openbible.mjs` asserts an exact
row-count floor and specific known edges post-ingest. A corrupted or truncated substitute file is
very likely caught functionally even with zero cryptographic verification; a *silent*,
structurally-valid tamper is the only gap left, and the threat model (single admin, own laptop, own
file) has no plausible actor for that.

**CSEC-3 verification.** Went looking for the "public-collections allowlist other flows enforce"
the panel cites, rather than accepting it as asserted — it's real:
`packages/scripture/src/queries.ts:161-165` exports `getPublicCollectionIds` (`SELECT id FROM
lumen.collections WHERE public = true`), and it's actually imported and called in the very same
route file, `scripture.tsx:347`, to gate the graph-panel's collection set. `getCrossReferences`
(`crossrefs.ts:33-71`) sits in the same file/route neighborhood and takes `collectionId` as a bare
opaque string with no equivalent check. Traced every call site: `scripture.tsx:134` sets
`collectionId` from a ternary over two inlined literals (`"openbible"` / `"phase-b"`) — never from
request input — so there is no exploitable path today. This is a real, concretely-sourced
inconsistency with an established sibling convention, not a speculative worry, but current
exploitability is genuinely zero.

**CSEC-4 verification.** Confirmed the SQL exactly: `edges_public_read`/`collections_public_read`
are both `USING (true)` (`setup-triggers-and-rls.sql:37-43`). Confirmed `lumen_read`
(`setup-readonly-role.sql`) is a plain `LOGIN` role, not the table owner/superuser, so RLS actually
binds it — this isn't a moot policy. Confirmed scope via `git diff main...HEAD --
scripts/setup-triggers-and-rls.sql`: empty diff, this branch touches nothing in this file. The
finding is accurate and non-trivial but is entirely pre-existing infrastructure this feature neither
introduces nor worsens in kind — it does add ~345k new rows that ride on the existing gap, but that's
a volume change, not a new mechanism.

**CSEC-5 verification.** Confirmed: the `openbible` INSERT (`ingest-openbible-refs.mjs:189-194`)
column list omits `public`. Confirmed against `scripts/ingest-phase-a.ts:154` (`CREATE TABLE
lumen.collections`) that the column is `public BOOLEAN DEFAULT true NOT NULL`. Default and intent
match exactly — this collection is meant to be public (CC BY 4.0 data, no `owner_id`). Implicit
reliance on a default is a legitimate style nit but has no daylight between current behavior and
correct behavior.

## Table

| ID | Tag | Stance vs. code-panel | Rationale (≤25 words) |
|---|---|---|---|
| CSEC-1 | material | uphold, sharpened (Medium) | Confirmed in both scripts; "mirrors sibling" holds only for smoke — `migrate-canon-spine.mjs` already scrubs this step, so ingest regresses, not mirrors. |
| CSEC-2 | noise | downgrade | Verified true (no checksum, gitignored file) but `UNMAPPED_CAP` + smoke row/edge assertions already catch corruption functionally; no plausible tamper actor in a single-admin threat model. |
| CSEC-3 | risky | uphold (Low) | Verified concrete: `getPublicCollectionIds` is a real sibling allowlist used in the same route for the graph panel and skipped here — zero exploitability today since both callers hardcode literals. |
| CSEC-4 | out-of-scope | uphold, rescoped | RLS gap confirmed real and non-trivial (`lumen_read` isn't exempt) but `git diff` confirms zero touch to this file on this branch — pre-existing infra, not this feature's regression. |
| CSEC-5 | noise | downgrade | Confirmed omitted from INSERT, but schema default (`public DEFAULT true`) exactly matches intended state for this collection — no gap between current and correct behavior. |
