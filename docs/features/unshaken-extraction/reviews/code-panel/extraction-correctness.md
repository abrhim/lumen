# Extraction-correctness review — feature/unshaken-extraction

Scope: `scripts/ingest-podcast/extract-lib.mjs` + `extract.mjs` (deterministic
extractors + merge pipeline). Method: full-file read of both files, plan.md
§Design/§Eval as contract, `scripts/__tests__/ingest-extraction.test.mjs` as
pinned behavior, plus live probes (node) against the exported functions for
every suspected edge case. All "probe:" lines below are actual observed
outputs, not speculation.

## Findings

### F1 — seedTraps infinite-loops when count ≥ number of mentions (HIGH)

- File: `scripts/ingest-podcast/extract-lib.mjs:444`
- Claim: once every sample index has been used as a trap, the inner
  `while (used.has(idx)) idx = (idx + 1) % evalSample.length;` cycles over a
  fully-used index set forever — the outer `guard` counter is never reached
  because the inner loop is what spins, synchronously blocking the event loop.
- Evidence:
  ```js
  let idx = Math.floor(rng() * evalSample.length);
  while (used.has(idx)) idx = (idx + 1) % evalSample.length;
  ```
  Probe: `seedTraps([m1, m2], { count: 3, rng, swapPool: ['a','b','c'] })`
  hung indefinitely (watchdog `setTimeout` could not even fire; process had to
  be killed). Plan §Eval draws 10–14 traps — any stratum/episode with fewer
  than `count` mentions hangs the eval run. Corollary at
  `extract-lib.mjs:445-448`: with **zero** mentions, `evalSample[0]` is
  undefined and `entry.target` throws
  (`TypeError: Cannot read properties of undefined (reading 'target')` —
  probed).

### F2 — agent timeline-review artifact is trusted verbatim: out-of-block chapters become 0.95-confidence DISCUSSES edges, malformed t disables pre-segment dropping (HIGH)

- File: `scripts/ingest-podcast/extract.mjs:120` (override), `:137-148`
  (chapter mentions), `:456-463` (readJudgment shape check is only
  `Array.isArray(tr.timeline)`)
- Claim: `timelineOverride` rows from `<id>.timeline-review.json` (untrusted
  judgment artifact) are never validated against `episodeChapters`, and their
  `t_start_s`/`seq`/`evidence` types are never checked — a hallucinated or
  malformed row flows straight into chapter mentions, edges, and verse-ref
  governing, violating the fail-closed/closed-vocab contract that every other
  path (resolveVerseRef, validateMention, validateAliasTable) enforces.
- Evidence, three probed sub-failures:
  1. `timelineOverride: [{ chapter: '2-chr-28', t_start_s: 5, seq: 0 }]` →
     mentions `[["chapter","2-chr-28",0.95]]` — a chapter outside the episode
     block becomes a mention; `aggregateToEdges` makes it a DISCUSSES edge and
     `buildExtractionLoadPlan`/`executeExtractionLoadPlan` insert it (edges
     have no FKs; the load plan never validates `toId`). It also becomes the
     governing chapter, so all real in-block verse refs under it fail
     resolution (recall collapse, surfaced only as resolutionFailures).
  2. `timelineOverride: [{ chapter: '2-kgs-14' }]` (missing `t_start_s`) →
     chapter mention with `t: undefined` (serializes to null), AND
     `firstSegT = Math.min(undefined) = NaN` so `u.t_start_s < NaN` is always
     false — **pre-segment dropping is silently disabled** — and `chapterAt`'s
     guess fallback (F11) resolves verse refs anyway (probed: verse mention
     emitted with governing '2-kgs-14').
  3. `evidence: 42` (non-string) → `quoteFrom` does `u.text.split(...)` →
     `TypeError: u.text.split is not a function` — episode crash on a value
     the code was told is agent-produced.

### F3 — verifyQuoteAtSeq passes empty / punctuation-only quotes: the PW-A7 fabricated-evidence gate is bypassable (MED)

- File: `scripts/ingest-podcast/extract-lib.mjs:345`
- Claim: `norm('')` and `norm('!!!…')` both normalize to `''`, and
  `windowText.includes('')` is always true, so a judged mention with an empty
  or punctuation-only quote sails through the gate the plan calls the thing
  that makes "fabricated evidence die in code"; no other layer
  (schema: `quote: {type:'string'}`, validateMention) requires a non-empty
  quote.
- Evidence:
  ```js
  if (!windowText.includes(norm(m.quote))) { … }
  ```
  Probe: `verifyQuoteAtSeq({ seq: 10, quote: '!!!…' }, …)` → `{ ok: true }`.
  A hostile/lazy principles agent can attach any in-pool target to any seq
  with `quote: ""` and be written at its claimed confidence.

### F4 — foreign-window close condition #1 (Q6) is unimplemented: in-block refs inside the ≤15-utterance quiet tail are dropped (MED)

- File: `scripts/ingest-podcast/extract-lib.mjs:195-237`
- Claim: plan Q6 records the close rule as "first in-block explicit
  chapter/verse-with-book ref OR 15 consecutive utterances without foreign
  tokens, whichever first" — the code implements only the quiet-count close
  (the function's own doc comment admits it), and it also extends `tEnd`
  across every quiet utterance, so an explicit in-block citation immediately
  after a tangent stays inside the window and its verse refs are
  `foreignDropped`.
- Evidence:
  ```js
  } else if (open) {
      quiet += 1;
      open.tEnd = u.t_start_s;   // quiet tail extends the window
  ```
  Probe: `['…Second Chronicles 28', 'back in Second Kings 15 verse three…',
  'verse four continues']` with `quietClose` default → one window
  `{tStart:100, tEnd:120}` covering both in-block utterances; in
  `runDeterministicExtraction` those refs increment `counts.foreignDropped`.
  Up to 15 utterances (~1–3 min of transcript) of legitimate in-block verse
  refs are lost after every tangent.

### F5 — foreign-book "chapter N" citations create false in-block timeline segments (MED)

- File: `scripts/ingest-podcast/extract-lib.mjs:125-130`
- Claim: the bare `chapter N` fallback in `detectChapterTransitions` has no
  awareness of a preceding foreign book name in the same utterance, so
  "Second Chronicles chapter fifteen" (spelled `chapter` form — NOT matched
  by the foreignBooks alias in this detector) emits a transition to the
  block's chapter 15, poisoning the governing timeline beyond the foreign
  window's close.
- Evidence: probe:
  `detectChapterTransitions([utt(0,10,'turn to Second Chronicles chapter fifteen for the parallel')], {episodeChapters:['2-kgs-14','2-kgs-15','2-kgs-16'],…})`
  → `[{"chapter":"2-kgs-15","t_start_s":10,…}]`. The foreign window (which
  DOES understand `(?:chapter\s+|section\s+)?`) suppresses verse refs while
  open, but the false segment persists after close — subsequent bare verse
  refs anchor to the wrong chapter until the next genuine transition, and the
  false chapter mention itself is emitted at confidence 0.95.

### F6 — validateAliasTable throws TypeError on malformed rows instead of rejecting them (MED)

- File: `scripts/ingest-podcast/extract-lib.mjs:280` (`row.names.filter`),
  `:291` (`nm.toLowerCase`)
- Claim: rows from the untrusted `<id>.aliases.json` with `names` not an
  array, or non-string members, crash the whole merge run for the episode
  instead of landing in `rejected` — one malformed row poisons all valid
  rows and fails the episode.
- Evidence: probes:
  `validateAliasTable([{id:'p1', names:'Ahas'}], …)` →
  `TypeError: row.names.filter is not a function`;
  `[{id:'p1', names:[42]}]` → `TypeError: nm.toLowerCase is not a function`.
  (The shell's per-episode try/catch in index.mjs makes this a loud episode
  failure rather than a corruption, but the function's contract — EV-A10
  "deterministic validation of agent-produced alias tables" — is to reject,
  not throw.)

### F7 — cross-set alias collision unrouted: agent alias equal to a different entity's base name double-matches (MED)

- File: `scripts/ingest-podcast/extract.mjs:248-255` (baseTable concat);
  `extract-lib.mjs:272-302` (validateAliasTable sees only the agent table)
- Claim: collision routing is enforced within the base pool (ambiguousNames)
  and within the agent alias table (validateAliasTable), but never ACROSS the
  two sets — a validated agent alias token identical to an unambiguous base
  pool name of a *different* entity matches BOTH ids on every occurrence,
  emitting a wrong-entity mention alongside each right one ("never first-win"
  becomes "both-win").
- Evidence: probe with pool `[Joram→person-joram-israel, Jehoram→person-jehoram-judah]`
  and alias row `{id: person-jehoram-judah, names:['Joram']}` on text
  "and Joram the king trembled" →
  `[["person-joram-israel",0.85],["person-jehoram-judah",0.75]]` — two
  mentions from one token, one necessarily wrong, both above the write floor.

### F8 — elided-pair heuristic fabricates wide verse ranges (MED)

- File: `scripts/ingest-podcast/extract-lib.mjs:168-171`
- Claim: the elision rule (`a >= 20 && b < 10 && end > a`) is meant for
  "verse twenty one and two" = 21–22, but accepts any larger final digit —
  "verse twenty one and nine" becomes range 21–29 and "verses twenty and
  five" becomes 20–25, emitting mentions at confidence 0.9 for intermediate
  verses (22–28 / 21–24) the speaker never referenced.
- Evidence:
  ```js
  if (a >= 20 && b < 10) {
      const end = Math.floor(a / 10) * 10 + b;
      if (end > a) return [{ verse: a, verseEnd: end }];
  }
  ```
  Probes: `'verse twenty one and nine'` → `[{"verse":21,"verseEnd":29}]`;
  `'verses twenty and five'` → `[{"verse":20,"verseEnd":25}]`. Only
  `end === a + 1` is a true elision; anything wider should fall through to
  two singles. (Related, lower severity: descending ranges — `'verse 24 to
  4'` → `[{verse:24}]` — silently discard the second number with no drop
  record.)

### F9 — null/malformed entries in judgment principles crash the merge episode (MED)

- File: `scripts/ingest-podcast/extract.mjs:533-541`
- Claim: `for (const m of judgment.principles)` builds
  `{ target: m.target, seq: m.seq, … }` before any validation — a `null`
  entry in a parseable `principles.<w>.json` (`{"mentions":[null, …]}`)
  throws `TypeError: Cannot read properties of null (reading 'target')`,
  failing the whole episode including all valid rows, where the design
  pattern everywhere else is per-row drop with reason.
- Evidence:
  ```js
  for (const m of judgment.principles) {
      const mention = { kind: 'principle', target: m.target, seq: m.seq, … };
  ```
  readJudgment only guards JSON.parse failures, not element shapes.

### F10 — common-word guard: one lowercase ASR occurrence erases an entity for the whole episode (LOW)

- File: `scripts/ingest-podcast/extract.mjs:233-247`
- Claim: `commonWordName` excludes a base name if every token appears
  lowercase *anywhere* in the transcript — a single Deepgram capitalization
  slip ("and joram slept") suppresses all capitalized occurrences of that
  name in the episode, even 40 clean hits; and since `aliasMatchCandidates`
  matches case-insensitively anyway, the guard's benefit ("So", "On") comes
  with an unbounded frequency-blind cost. Panel F1's own premise is that ASR
  mangles proper nouns.
- Evidence: probe with utterances `['and joram slept', 'Joram reigned',
  'Joram died']` and pool name Joram → **zero** person mentions. Recovery
  only via the judgment alias path (census contains the lowercase token, so
  an agent alias row can validate) at the reduced 0.75 confidence.

### F11 — chapterAt falls back to guessing the first segment's chapter for pre-first t (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:77`
- Claim: `return current ?? sorted[0]?.chapter ?? null;` returns the FIRST
  segment's chapter for a t before any segment — contradicting the A9
  "flagged, never guessed" contract that stampChunks implements correctly;
  the deterministic pass normally shields it with the `u.t_start_s < firstSegT`
  drop, but F2's malformed-override probe showed the fallback firing in
  production code (missing `t_start_s` → NaN firstSegT → guessed governing).
- Evidence: probe: `chapterAt([{t_start_s: 300, chapter: '2-kgs-14'}], 10)`
  → `'2-kgs-14'`.

### F12 — dedupeMentions merges transitively beyond ±5s (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:367`
- Claim: the window is measured from the currently-kept mention, and the kept
  pointer advances when a higher-confidence later mention wins, so chains of
  mentions each ≤5s apart collapse into one even when the extremes are far
  beyond 5s — under-counting distinct discussion moments in edge mentions.
- Evidence: probe: ts `[100, 104, 108]` (conf .8/.95/.7) → one surviving
  mention (t=104); 100 and 108 are 8s apart yet merged. Q2 says "same
  (kind,target) within ±5s merges".

### F13 — ambiguous or out-of-block announced chapters vanish with no counter or census surface (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:128-133`
- Claim: bare "chapter N" where N exists in >1 block book
  (`books.length === 1` fails) and alias-matched chapters outside the block
  (`!blockByBook.get(f.bookId)?.has(f.num)`) are skipped silently — no
  drops entry, no counts field, and the coverage census cannot see them
  (lowercase "chapter" never matches the capitalized-head bigram; `chapter`
  is a CONTAINER_NOUN). EV-A7's premise is that novelty surfaces at run time.
- Evidence: `if (books.length === 1) found.push(…)` — the `!==1` branch has
  no else; the filter at `:133` has no logging.

### F14 — "<book> chapter N" in-block form not matched by the alias pattern (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:120` vs `:207`
- Claim: the in-block transition detector requires the number immediately
  after the book alias (`\b<alias>\s+NUM\b`), so "Second Kings chapter 21"
  falls through to the bare-chapter path — fine for single-book blocks, but
  dropped when block books share the number (F13), and asymmetric with
  `detectForeignWindows`, whose regex explicitly supports
  `(?:chapter\s+|section\s+)?`.
- Evidence:
  ```js
  const re = new RegExp(`\\b${esc(alias)}\\s+${NUM}\\b`, 'gi');          // :120
  `\\b${esc(alias)}\\s+(?:chapter\\s+|section\\s+)?${NUM}\\b`,           // :207
  ```

### F15 — symbol entities are fetched and prompted but can never produce a mention or edge (LOW)

- File: `scripts/ingest-podcast/extract.mjs:271`;
  `extract-lib.mjs:381-388` (REL_BY_KIND), `:507` (poolIds)
- Claim: symbols are in the candidate pool and in `prefilterCandidates`
  output, but the entity loop skips `kind === 'symbol'`, alias validation's
  poolIds excludes them, and REL_BY_KIND has no symbol mapping
  (aggregateToEdges silently drops the kind) — dead weight at best, silent
  contract gap at worst (plan probe 4 counts symbols in the pool).
- Evidence: `if (!kind || kind === 'principle' || kind === 'symbol') continue;`

### F16 — assembleEpisode: `Number('') === 0` lets a malformed custom_id claim chunk 0; non-array mentions throws (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:414-422`
- Claim: a custom_id ending in `:` yields `Number('') === 0`, which
  satisfies `Number.isInteger` and silently claims (or clobbers) chunk 0;
  hex strings ('0x2' → 2) also pass; and `mentions.push(...(r.mentions ?? []))`
  throws on a non-iterable `mentions` value instead of treating the chunk as
  invalid.
- Evidence: probes: `custom_id: 'ep:p2:'` → `missingChunks: []`, mention
  absorbed as chunk 0; `mentions: {not:'array'}` →
  `TypeError: Spread syntax requires ...iterable`.

### F17 — rng edge and empty-input crashes in eval helpers (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:472` (stratifiedSample),
  `:445-448` (seedTraps)
- Claim: an injected rng returning exactly 1 (legal for some seeded PRNGs)
  makes `pool.splice(pool.length, 1)[0]` return undefined, which is pushed
  into the sample and counted toward `perEpisode`; seedTraps on empty
  mentions throws (see F1 corollary).
- Evidence: probe: `stratifiedSample([...2 mentions], { perEpisode: 2, rng: () => 1 })`
  → `[null, null]` (two undefined entries).

### F18 — coverage census counts digit-form book heads ("2 Kings 21" → head "Kings") as unmatched (LOW)

- File: `scripts/ingest-podcast/extract.mjs:303-306`
- Claim: the capitalized-head bigram regex can't start at a digit, so for
  "2 Kings 21" it matches "Kings 21" and reports head "Kings", which is not
  in knownHeads ("2 kings"/"second kings" are) — every digit-form citation of
  an already-covered book inflates `unmatchedBookHeads`, training operators
  to ignore the alarm the census exists to raise.
- Evidence: `/\b([A-Z][a-z]{2,}(?: [A-Z][a-z]{2,})?)\s+\d{1,3}\b/g` with
  `knownHeads.has('kings')` false.

### F19 — fingerprint mismatch check compares utteranceCount only, ignores durationS (LOW)

- File: `scripts/ingest-podcast/extract.mjs:489`
- Claim: the PW-A6 guard records `{utteranceCount, durationS}` but
  extract-merge compares only the count — a re-transcription that happens to
  produce the same utterance count (same audio, different Deepgram params
  shifting every t) passes the gate with stale seq/t anchors.
- Evidence:
  `if (utterances.length !== codeArtifact.fingerprint.utteranceCount)` —
  durationS never read.

### F20 — multi-word agent aliases can never validate (census holds single tokens) (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:280`;
  `extract.mjs:506` (censusTokens built from single-word matches)
- Claim: censusTokens contains only individual word tokens, but
  `validateAliasTable` checks `censusTokens.has(nm.toLowerCase())` on the
  whole alias string — any multi-word ASR variant ("Mount Karmel") is
  rejected "alias not in census" even when both tokens are present; fail-
  closed, but a silent capability gap the alias agents can't route around.
- Evidence: `\b([A-Za-z][a-z]{1,})\b` census vs whole-string `has()`.

### F21 — agent-timeline seq fallback `?? 0` mislabels evidence on float-t mismatch (LOW)

- File: `scripts/ingest-podcast/extract.mjs:139`
- Claim: when an override segment lacks `seq` and its `t_start_s` doesn't
  float-equal any utterance's t (the very trap the adjacent comment names),
  the fallback stamps `seq: 0` and quotes utterance 0 — a wrong-but-plausible
  anchor instead of a flagged one, feeding gold selection (eval) fabricated
  evidence pairs.
- Evidence:
  `const seq = seg.seq ?? utterances.find((x) => x.t_start_s === seg.t_start_s)?.seq ?? 0;`

### F22 — citation guard gaps: number-words uncovered; whole-utterance suppression (LOW)

- File: `scripts/ingest-podcast/extract.mjs:263-274`
- Claim: `\b${name}\s+\d` covers only digit forms — "Samuel eight" (ASR
  writes number words) still emits Samuel-the-person; conversely, when a name
  appears BOTH as citation and standalone in one utterance ("Moses climbed
  the mount; the law of Moses says"), the standalone mention is suppressed
  too (suppression is per-utterance, not per-occurrence).
- Evidence: `citationRe` alternatives contain `\\b${name}\\s+\\d` but no
  NUMWORD branch; the guard `continue`s the whole hit.

### F23 — spokenNumberToInt is order- and repetition-insensitive (LOW)

- File: `scripts/ingest-podcast/extract-lib.mjs:25-35`
- Claim: it sums any sequence of number words — "three twenty" → 23,
  "twenty twenty" → 40; unreachable via the NUM regexes (which constrain
  shape) but reachable via the contextBreak capture
  (`extract.mjs:164`, `[a-z]+(?:[ -][a-z]+)?` captures arbitrary word pairs),
  where a nonsense sum that collides with a block chapter number changes
  drop behavior.
- Evidence: probe: `spokenNumberToInt('three twenty')` → 23;
  `('twenty twenty')` → 40.

### F24 — unused import `statSync` (LOW/noise)

- File: `scripts/ingest-podcast/extract.mjs:6`
- Claim: `statSync` is imported and never used.
- Evidence: `import { readFileSync, existsSync, statSync, writeFileSync, renameSync } from 'node:fs';`
  — no other occurrence in the file.

## Verdict

The deterministic core is genuinely fail-closed on its own outputs (verse
resolution, closed vocab, write floor, dedupe, per-episode isolation are all
harness-pinned and correct), but the boundary where agent-produced judgment
artifacts enter is materially weaker than the plan's contract: the timeline
override is trusted verbatim (F2 — the one path that can mint an
out-of-block DISCUSSES edge at 0.95), the quote-at-seq gate accepts empty
evidence (F3), and three separate malformed-shape paths crash the episode
instead of rejecting rows (F6, F9, F16). Two recorded plan defaults are
silently unimplemented or overreaching (Q6 close rule F4; elision F8), and
seedTraps carries an unconditional hang (F1) that will bite the first
small-stratum eval run. Recommend fixing F1–F9 before the eval round;
F10–F24 are census-quality and robustness cleanups that can ride along.
