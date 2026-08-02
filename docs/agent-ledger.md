# Agent ledger

What agents working in this repo have learned, so the next one doesn't pay for
it again. Append; don't rewrite. Newest at the top.

Entries are for **surprises** — the thing that wasn't where you expected, the
check that looked green but wasn't, the assumption the codebase quietly
violates. If nothing surprised you, add nothing.

---

## 2026-08-01 — the local stack, and four ways local lied about prod

Setting up the local Supabase stack so tests stop running against production.
Everything below cost real time.

- **`information_schema` is permission-filtered.** It silently omits grants the
  connecting role can't see. A schema dump built from
  `information_schema.role_table_grants` came back missing every write grant the
  app needs, and the first symptom was "permission denied for table notes" at
  runtime. Read `pg_class.relacl` / `pg_attribute.attacl` instead.
- **Production uses COLUMN-level grants.** `authenticated` may write only
  `notes.body_md` and `notes.deleted_at`. Miss them and local is *more*
  permissive than prod — tests pass locally and the real boundary is only ever
  exercised in production.
- **`apps/web/.env` holds a PRODUCTION DSN** under the name
  `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, and vite
  auto-loads it. Exporting the `WRANGLER_`-prefixed variant instead does not
  error — it falls through to prod. Every drizzle read went to us-west-2 while
  `SUPABASE_URL` and `DATABASE_URL` both looked correctly local. The tell was
  that seed changes had no effect on test results.
- **Search degrades instead of failing.** `lumen_read` needs `USAGE` on the
  `extensions` schema (pg_trgm, unaccent). Without it six of seven search groups
  return nothing, the page still renders, and the e2e suite still passes.

Two smaller ones: `transcripts.search_vector` is `GENERATED ALWAYS` and rejects
any supplied value, while `verses.search_vector` looks identical in the schema
but is trigger-maintained and must be carried. And vite silently moves to the
next port when 4179 is taken, so a stale dev server means your tooling is
talking to a different process than you think.

Runbook: `docs/ops/local-stack.md`.
