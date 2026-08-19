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

## 2026-08-19 — Extraction on interview register: six eval rounds

The no-block extraction variant (verbatim shows, spans:null) shipped for
Stick of Joseph. Verse/chapter and principle strata pass their gates;
the entity stratum does not, and the reason is structural rather than
fixable by another guard.

- **Interview register has a ~0.80 ceiling on pure name matching.**
  Unshaken clears 0.85 because its chapter block disambiguates —
  "Samuel" inside a 1 Samuel episode is the prophet. Without a block,
  "Abraham Lincoln", "Jackson Paul" (the hosts' surname), "Quick Media",
  "Mormon Stories", "in Timothy", "the modern State of Israel", and
  "Father Gabriel the guest priest" are all live collisions. Twelve
  deterministic guards took entity precision 0.667 → ~0.80 and then
  stopped paying. What is left is a long tail, not a class.
- **The load gate is per-stratum now** (`checkLoadGate` returns
  `allowedRelTypes`). DISCUSSES + TEACHES load; MENTIONS is held on
  disk. The bars did not move — the gate stopped being all-or-nothing.
- **Confidence carried the principle signal.** Round-3 misses clustered
  at ≤0.65 while correct ones sat at 0.7 median, so a 0.7 write floor
  (`validateMention({floor})`) pruned the topic-word tail: 1,394 → 837
  TEACHES edges, and the stratum went 0.83 → 0.97.
- **Never re-run all eval shards to fix one.** A flaky evaluator
  rewrites a previously COMPLETE verdict file one item short; across
  rounds 1-5 every full pass fixed one shard and broke another. The
  workflow now takes `shardList`. A verdict that stays short twice is
  not flake — check the journal, the item's first-run verdict is
  recoverable from it.
- **The local stack's seed carries ~162 verses, not the canon.**
  Extraction resolves against `lumen.verses`, so a local run silently
  drops nearly every reference. Extraction reads must point at prod
  (`INGEST_DATABASE_URL` overrides the .env DSN in the other direction
  for loads).
- ASR writes "D&C", never "Doctrine and Covenants" — the alias list is
  the only reason those chapters anchor at all.

## 2026-08-19 — building a text corpus from the web

- **WebFetch silently returns a summary instead of the source text, and
  it does this inconsistently.** Same tool, same prompt shape: most of
  40 blog articles came back verbatim, three came back as third-person
  paraphrase. Nothing in the response says which you got. A corpus
  assembled this way looks complete and is partly a model's prose. If
  you are measuring *how someone writes*, that is not a small
  contaminant — it is the measurement. Detect it before analysing:
  first-person markers per 1k chars separates them cleanly here
  (verbatim 2.3–8.6, paraphrase 0.0–0.8). Tell fetch agents to record
  `=== FAILED: <url> ===` rather than drop a miss, or the holes are
  invisible too.
- **Counts produced by a subagent need a deterministic recount before
  they become rules.** Three numbers in an otherwise careful analysis
  were wrong in ways that would have shipped: four connectives asserted
  at "literal zero" were 1/2/3 occurrences; *therefore* was banned as
  absent while appearing exactly as often as *however*; and a
  "self-implicating *we* rises on the page" finding reversed sign on a
  larger sample (13.0 → 7.6 per 1k, it falls — what actually collapses
  is *you*, 16.7 → 2.3). All three were caught by a ~20-line Python
  count over the same files. Agents sampled 14.2k of 31.4k available
  words; their *sentence-length* figures matched an independent recount
  to within 0.5%, so sampling was not the problem — assertions of
  absence were. Absence is the claim a sample cannot support.
- **Strip quoted material before measuring prose style.** These essays
  are 17% block quotation (KJV, Nibley, Friedman). Here it barely moved
  the result (mean 25.3 → 24.7), but that was luck, not method — and
  one specimen the analysis attributed to the blog's author was
  actually a scholar he was quoting.
- **ldsscriptureteachings.org permalinks have no day segment**
  (`/2020/03/slug/`, not `/2020/03/08/slug/`), and its category index
  pages interleave article links with YouTube, PDF and MP3 URLs plus
  per-episode "quotes and notes" show notes. Roughly one link in seven
  on those pages is a real essay.

## 2026-08-19 — editing a skill that has a companion file

- **A skill's reference file is a second method document, and the skill
  orders you to read it.** `principle-essay/SKILL.md` says "Read
  `teaching-patterns.md` before drafting." Collapsing four voice
  personas to one in SKILL.md while patching two lines of the companion
  left six live instructions that lose to the new checklist — an
  opening shape whose first beat was "No thesis", a ban on *therefore*
  that a recount had already overturned, and "the three teachers are a
  menu, not a blend." A draft built from the companion would have
  failed the skill's own gate. If you change a rule, grep BOTH files
  for the rule's subject, not just the file you are editing.
- **The cheapest real test of a writing skill is to make an agent draft
  from it and report where it got stuck** — not to review it. The
  drafting trial is what surfaced that the four-parenthesis cap and the
  three-to-eight-passages rule are arithmetically incompatible if
  citations are parenthetical, and that the writer had silently guessed
  which way to resolve it. Two reviewers reading the same file for
  contradictions both missed it.
- **`lumen.verses` cannot be verified against the local stack** (~162
  rows) and the column is `reference`, not `ref`. Any instruction to
  "check the passage against the database" has to say it reads
  production read-only, or it quietly trains quoting from memory.
