# Bugs — unshaken-ingest (A1)

Pre-seeded during step 8b; the step-11 bug filter owns final disposition.

## Known issues from the live run (pre-code-review)

- **W1 — upload_date stored as literal "NA" for all 10 episodes.** yt-dlp's
  flat-playlist mode emits `NA` for `%(upload_date)s`; enrichEpisode stored it
  verbatim in entity metadata. Real dates ARE available in the fetch stage's
  `--print-json` output but weren't threaded through. Panel-2 explicitly
  deferred date/thumbnail handling to Phase B (CON-4 tagged noise: "B is
  design's stated landing-page owner"), so this is recorded, not fixed here.
  Phase B backfills via one metadata pass; the idempotent re-load makes it a
  loads-only re-run (transcripts cached).
- **W2 — jsonb returns as a JS string on some postgres.js paths** (COR-5's
  class, jsonb edition). Bit smoke-media's descriptor check (data was correct;
  the check read `.media` off an unparsed string). Smoke now parses-if-string.
  Rule for Phase B loaders: treat BOTH numeric and jsonb reads as
  possibly-string; the app's `fetch_types: false` config makes this a
  certainty there, not an edge case.

## Step-8 fix log (already closed, for code-review context)

- Runner read `DEEPGRAM_API_KEY` from `process.env` while the key lives in
  root `.env` — caught by first dry-run; fixed (47bf9d2).
- Per-row transcript INSERTs (6,030 statements/tx) stalled "idle in
  transaction" 12min through the pooler on the first real run — clean
  rollback, zero data loss; fixed with 500-row batched inserts + SET LOCAL
  statement/idle-in-tx timeouts (0e485b6). Run-2 loaded the same episode in
  seconds.
- Monitor self-terminated on the RETRY process's `run_done` while the main
  batch still ran (shared log file + terminal-pattern match) — one load event
  observed only via the database. Workflow note for retro, not app code.
