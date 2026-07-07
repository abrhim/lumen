# Code Panel — Security Review — tske-cross-references

Reviewed `tske-impl.diff`, `scripts/ingest-openbible-refs.mjs`, `scripts/smoke-openbible.mjs`,
`packages/scripture/src/crossrefs.ts`, and `apps/web/app/routes/scripture.tsx`.

Verified clean, for the record: **all SQL is parameterized** — `crossrefs.ts`'s UNION query binds
`verseId`/`collectionId`/`limit` via drizzle's `sql` tagged template (`crossrefs.ts:47-49,61-63`),
never string-concatenated; `verseId` is built from a URL `bookId`/`chapter`/`verse` that the loader
already validates/canonicalizes (`parseReference`, `/^\d+$/` chapter/verse guards,
`scripture.tsx:302-314,154-159`) before it ever reaches SQL, and would be safely bound even if it
weren't. The two `sql.unsafe()` calls in `smoke-openbible.mjs:28,83-85` are fully static string
literals with zero interpolation — no injection surface. `ingest-openbible-refs.mjs` never calls
`fetch`/`http` anywhere; the source TSV is read only via local `readFileSync(DATA_FILE, ...)`
(`:163`), satisfying SEC-1 (no network fetch while holding the admin DSN). `lumen_read` does have
`SELECT` on `lumen.edges`/`lumen.collections` (blanket schema grant,
`scripts/setup-readonly-role.sql:14-16`) and the app's runtime path (`apps/web/app/lib/db.server.ts`
via the Hyperdrive binding) is confirmed on that scoped read-only role, distinct from the admin
session-mode `DATABASE_URL` the ingest/smoke scripts use. The new `openbible` collection reads
correctly because `public` defaults to `true` in the schema. External license links render with
`target="_blank" rel="noreferrer"` (`scripture.tsx:976-991`), and the rendered attribution — source
name + link, CC BY 4.0 + link, and an explicit "adapted — ranges expanded" note
(`scripture.tsx:973-995`) — meets CC BY 4.0's identify-source/link-license/indicate-changes bar.

| ID | Severity | Where | Problem (≤ 25 words) | Fix (≤ 30 words) |
|---|---|---|---|---|
| CSEC-1 | Medium | `scripts/ingest-openbible-refs.mjs:134-142`, `scripts/smoke-openbible.mjs:14-19` | `.env`/URL/port checks and `postgres()` client construction run before the `try`, so a thrown connection error escapes the `scrub()`-guarded catch entirely. | Move env read, URL validation, and client construction inside the try/catch that calls `scrub()` before logging or exiting. |
| CSEC-2 | Low | `data/openbible/cross_references.txt` (gitignored via `data/`), read at `scripts/ingest-openbible-refs.mjs:163-167` | Vendored TSV has no checksum recorded or verified; a substituted/corrupted local file is ingested with only structural checks, no authenticity check. | Record a SHA-256 in `data/openbible/README.md` and assert it at ingest startup before reading the file. |
| CSEC-3 | Low | `packages/scripture/src/crossrefs.ts:33-43` (`getCrossReferences`) | `collectionId` is queried directly against `lumen.edges` with no check against the public-collections allowlist other flows enforce (`getPublicCollectionIds`) — safe only because callers hardcode it today. | Validate `collectionId` against the public-collections allowlist inside `getCrossReferences` itself, not just at call sites. |
| CSEC-4 | Low | `scripts/setup-triggers-and-rls.sql:37-43` (pre-existing, unmodified by this branch) | `lumen.edges`/`lumen.collections` RLS policies are `USING (true)` — the `public` column that gates app visibility is enforced only at the app layer, not by RLS, for the read-only role. | File a follow-up: filter RLS on `public = true` (and future `owner_id`) instead of relying solely on app-layer `WHERE public = true`. |
| CSEC-5 | Low | `scripts/ingest-openbible-refs.mjs:189-194` (collection upsert) | The `openbible` collection INSERT never sets `public` explicitly; visibility depends implicitly on the schema's default value rather than a stated intent. | Add `public = true` (and keep it in the `ON CONFLICT` `SET` list) so visibility is explicit and audit-visible. |
