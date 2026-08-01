# Local stack

A disposable Supabase running on localhost, so the e2e suite stops running
against production.

## Why

`playwright.config.ts` used to say the quiet part out loud: the suite ran
"against the Vite dev server (live dev DB through the same Hyperdrive DSN the
app uses)". Every run created real `auth.users` rows and cast real
`lumen.roadmap_votes` — the cleanup in `e2e/support/session.ts` exists because
those votes once compounded into triple digits on the public roadmap.

That is survivable when a person runs the suite a few times a day. It is not
survivable when an agent runs it on every push, forever.

## Prerequisites

Docker, and that is the only one. The Supabase CLI comes via `npx`.

```bash
brew install --cask docker
```

On the Linux VM: `curl -fsSL https://get.docker.com | sh`.

## Daily use

```bash
pnpm db:start
```

Boots Postgres + GoTrue + PostgREST, applies `supabase/migrations/`, runs
`supabase/seed.sql`, and writes `apps/web/.dev.vars` pointed at the local API.
First run pulls images and takes a few minutes; after that it is seconds.

```bash
pnpm verify
```

The gate: typecheck, unit tests, script tests, then the full Playwright suite
against the local stack. Exit 0 means a change is fit to open a PR for. Add
`--no-e2e` to skip the slow leg while iterating.

```bash
pnpm db:reset   # back to a clean seed — the fastest way out of bad state
pnpm db:stop    # free the ports
```

| Service  | URL                     |
| -------- | ----------------------- |
| API      | http://127.0.0.1:54321  |
| Postgres | `postgres:postgres@127.0.0.1:54322/postgres` |
| Studio   | http://127.0.0.1:54323  |
| Mail     | http://127.0.0.1:54324  |

## How the wiring works

Three consumers need the same facts in three shapes, which is what
`scripts/local-stack.mjs` exists to reconcile:

- **The Worker** reads `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` from
  `apps/web/.dev.vars`, which overrides the production values in
  `wrangler.json` `vars`. Written by `pnpm db:start`; gitignored.
- **The drizzle leg** reads `env.HYPERDRIVE.connectionString`. In local dev
  wrangler fills that from
  `WRANGLER_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`, which is a *process*
  env var — it cannot live in `.dev.vars`. `scripts/verify.sh` exports it.
- **The suite** reads `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` and `DATABASE_URL` from process env, all
  defaulting to production if unset — so an unconfigured run behaves exactly as
  it always has, and only `verify.sh` moves it off prod.

`verify.sh` refuses to run the suite if `SUPABASE_URL` looks like production or
`DATABASE_URL` is not local. That guard is the point of the whole exercise.

## What is in the database

**Schema** — `supabase/migrations/20260801000000_baseline.sql`, a schema-only
dump of `lumen`: 21 tables, 2 views, 9 functions, 4 triggers, 23 RLS policies,
and the `lumen_read` role the production GRANTs reference. Excludes
`auth`/`storage`/`realtime`/`vault`, which Supabase provisions itself, and the
three legacy `public.*` tables the app no longer reads.

**Data** — `supabase/seed.sql`, ~1.5 MB. The real corpus is 2.6 GB and 1.2M
words; this is a bounded slice sized to what the specs actually read:

| Slice | Why |
| --- | --- |
| Alma 32/33, Enos 1, 1 Ne 3, D&C 4 | the chapters specs navigate to |
| Genesis 1 | Strongs tagging only covers the KJV — without a Bible chapter, `word_tags` seeds empty |
| all books/chapters/volumes | the index pages |
| Strongs H1–H100 + G-range | `/strongs` opens on the H1–100 page |
| one podcast episode | so the `/media` specs run instead of skipping |
| 300 `search_index` rows matching "faith" | the suite's only full-text assertion |
| all 37 roadmap features | `/roadmap` |

Both files are generated. To refresh from production:

```bash
pnpm db:regen
```

That needs the admin `DATABASE_URL` in the repo-root `.env`. It is a developer
task — **the VM never needs production credentials**, because the schema and
seed are committed.

Adding a spec that reads rows the slice does not carry? Widen `CHAPTERS` or
`SLICES` in `scripts/dump-seed.mjs` and regenerate. Do not hand-edit either
file; the header says so and the next regeneration will overwrite you.

## Known gaps

- **Google OAuth is disabled locally.** `auth-oauth.spec.ts` only asserts the
  shape of the `/auth/v1/authorize` redirect the app builds and never completes
  a round trip, so this costs nothing today. A spec that actually signs in
  through Google would need a real client configured in `config.toml`.
- **Neo4j is not in the stack.** `neo4j.server.ts` still points at the hosted
  instance. No current spec depends on it; a graph spec would need a
  `neo4j:community` container added alongside.
- **The Supabase CLI is unpinned** (`npx --yes supabase`). Fine for a laptop,
  worth pinning to a devDependency before an agent depends on it — a silent
  major bump is the kind of thing that fails at 3am.
