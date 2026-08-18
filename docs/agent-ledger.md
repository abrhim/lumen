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

## 2026-08-18 — YouTube media downloads 403 on stable yt-dlp

The brew-installed yt-dlp (2026.07.04, latest stable) still reads metadata
fine — discover resolves all 58 SoJ episodes — but every actual media
download returns 403. YouTube's SABR/PO-token enforcement rotated past the
stable release; `web_safari`/`ios`/`tv` clients yield only storyboards or
DRM, `android_vr` lists real m4a formats whose URLs still 403. The fix that
worked: yt-dlp **nightly** via `uv tool install --force -p 3.12
--prerelease=allow "yt-dlp[default]"` (ships yt-dlp-ejs, the JS challenge
solver; node is already present). The nightly lands in `~/.local/bin`,
which shadows `/opt/homebrew/bin` in PATH, and the pipeline's `childEnv`
is subtractive so child processes inherit that PATH — no code change.

Implications: the weekly Unshaken re-run fetches nothing new most weeks so
it will look healthy until the next new episode 403s; and any environment
without `~/.local/bin` early in PATH (cron, a fresh shell profile) silently
falls back to the stale brew binary. Check `yt-dlp --version` before
blaming the pipeline.

## 2026-08-18 — Fleet day: the engine switched under adjudication

Deepgram's bake-off "win" did not survive contact with a human ear.
Abram judged the first 14 disagreement sites 14/14 for WhisperX, and
YouTube-as-third-witness agreed 2:1 across the hour. Vocabulary counts
tie; conversational content does not. If you are choosing an engine,
adjudicate real disagreements — do not trust term-count parity.

Traps hit on the way to a green fleet:

- **whisperx 3.8 fetches pyannote/speaker-diarization-community-1
  assets even when you pin model_name to 3.1.** Three gated HF repos
  need accepted terms, not two. The Modal preflight function exists so
  a 403 costs cents on CPU, never GPU-minutes after transcription.
- **A brand-new Modal workspace got disabled mid-run** (verification
  tripwire after several GPU batches). Dashboard verification fixed it;
  one episode survived because outputs stream back per-episode.
- **The channel misspells its own host.** All nine video titles say
  "McLauchlin"; the man is McLaughlin (Abram). Channel metadata is not
  ground truth for names — and a keyterm will happily bias the engine
  to a WRONG spelling with total authority.
- **The e2e fixture teardown deleted the whole soj-todd-mclauchlin
  collection row.** Harmless when only the fixture existed; after the
  real load it wiped live local data on every run. Fixture teardowns
  must delete exactly what the fixture created.
- **transcriptPathFor is engine-aware per show** (.whisperx.json vs
  .deepgram.json). Do NOT unify the filenames: renaming Unshaken's
  cache forces a full paid re-transcribe on the next weekly run.
- Background-shell habits that keep biting: a `| grep | tail` pipe
  swallows the real exit code (a "green" gate run had 1 failed test)
  and buffers interim output; redirect to a log file and echo `$?`.
