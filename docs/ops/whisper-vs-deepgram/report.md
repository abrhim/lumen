# Whisper vs Deepgram — transcript quality evaluation for Unshaken

Date: 2026-07-20. Evaluation only — no pipeline changes. Reference transcripts: existing
`data/podcasts/unshaken/*.deepgram.json` (nova-3 + top-100 keyterm boosting, ~$0.0077/min).
Candidate: local Whisper on this machine (Apple M5 Pro, 18 cores, 48 GB, Metal).

## TL;DR

**Local Whisper would feed the extraction pipeline better than Deepgram, and the margin is
largest exactly where the pipeline has been hurt** — canonical proper-noun spelling.
Vanilla large-v3, with no keyterm help at all, spelled **Ahaz 46/46** across the full
canonical episode where keyterm-boosted Deepgram went 0/46 ("Ahas", the defect that forced
the alias workaround); it also wins Jehoiakim (16 vs 0), Jehoahaz, Urijah, Uzziah,
Tiglath-Pileser, and ties the ~28 keyterm-boosted names audited. Timestamps are at parity
(constant +60 ms offset, then 94–96% of words within ±200 ms, flat across 3.6 h).
Verse-number rendering is near-identical. The honest caveats: on *acoustically confusable*
name pairs Deepgram is genuinely better — it wins the episode's divergent
Syrians/Assyrians sites 2-to-1 and it preserved the Jehoiakim/Jehoiachin father-son
distinction (~4 clean sites) that every Whisper-family decoder flattened (confirmed real
by an independent-architecture referee). Whisper vanilla also produced two small
repetition events in 3.6 h — ~34 words at minute 112, and "Come unto Christ" ×4 over the
outro, the latter *evading* the automated scans. Net: Whisper's language-model prior gives
canonical spellings but occasionally steamrolls fine phonetics; Deepgram hears better and
spells worse — and consistent misspelling is aliasable, while Whisper's rare entity-merges
are not. The trade still favors Whisper for this pipeline, but it is a trade, not a sweep.
Recommended config if adopted: **large-v3 vanilla** (10× realtime). The carry-prompt
variant looked best on the slice but **corrupted two prompted names at episode scale**
(Manasseh→"Manaessah" 9×, Zedekiah→"Zechariah" 4×) — do not ship it without
re-validation. Turbo (36× realtime) is close but produced two Deepgram-class garbles
("Eurijah" ×2, "Sennachera") that large-v3 did not. Cost: $0 marginal vs ~$1.66/episode,
at ~21 min (v3) or ~6 min (turbo) of unattended M5 Pro time per 3.6 h episode.

## Tool choice

**whisper.cpp 1.9.1 (Homebrew) + Metal, ggml-large-v3**, word timestamps via `--dtw large.v3`.

Why not the alternatives:

- **faster-whisper (CTranslate2)**: no Metal support — CPU-only on macOS. Used here as a
  *timestamp referee* on the slice (its cross-attention word alignment is the
  reference-quality implementation), not as the bulk engine.
- **WhisperKit**: ships quantized CoreML variants by default — adds a quantization confound
  to a quality eval.
- **large-v3-turbo** (distilled 4-layer decoder) was spot-checked as the speed/quality trade.

Gotcha that shaped the setup: whisper.cpp enables flash-attention by default and **silently
disables DTW token timestamps when flash-attn is on** (t_dtw = -1). All quality runs used
`-nfa`; flash-attn runs were kept only as speed baselines. With `-nfa --dtw`, DTW coverage
was 100% of words.

Invocations (audio pre-converted to 16 kHz mono wav with ffmpeg; whisper.cpp does not read m4a):

```
# quality + word timestamps
whisper-cli -m ggml-large-v3.bin -f ep.wav -l en -nfa --dtw large.v3 -oj -ojf -of out
# keyterm-analog condition (adds, re-injected every window)
  --prompt "$(cat names.txt)" --carry-initial-prompt
# speed baselines: default flash-attn, no --dtw
```

## Conditions tested

| Condition | What it is | Why |
|---|---|---|
| Deepgram nova-3 + keyterms | existing reference transcripts | incumbent |
| Whisper large-v3 vanilla | no prompt | is Whisper's world knowledge enough unaided? |
| Whisper large-v3 + `--prompt` | top-100 names, first window only | naive keyterm analog |
| Whisper large-v3 + `--prompt --carry-initial-prompt` | same names, every window | honest keyterm analog |
| Whisper large-v3-turbo vanilla | distilled decoder | speed/quality trade |

**Fairness note.** The prompt list is the *same* top-100 person/place list Deepgram was
seeded with, reproduced via the pipeline's own SQL (read-only) against `lumen.entities`.
Two caveats, stated plainly: (1) the DB has evolved since the original transcription run, so
this is the best available reproduction, not a byte-identical replay; (2) Whisper's prompt
window keeps only the **last** ~224 tokens, so the list was ordered most-frequent-first so
that truncation drops names Whisper cannot miss anyway (David, Moses); Deepgram accepted all
100. Critically, **"Ahaz" is not in the top-100 list** — so on the headline probe, *both*
engines were unaided, which makes the comparison clean.

## Sample

- **Slice** (method validation): 1450–2350 s of `4pSrikfJ5Yw` (2 Kings 14–25) — the
  densest proper-noun window in the episode (28 Ahaz mentions, Tiglath-Pileser, Urijah,
  Uzziah, a dozen verse refs). 2,598 Deepgram words / 200 utterances in-window.
- **Full episode** (the result): `4pSrikfJ5Yw`, 3h36m (12,991.7 s), 3,045 Deepgram
  utterances. Chosen over the smaller `ivzxaLpbZws` because it is the project's canonical
  sample, it contains the known Ahas defect plus the hard late-episode names
  (Jehoahaz/Jehoiakim/Jehoiachin in 2 Kings 23–25), and 3.6 h is the honest stress test for
  Whisper's long-form drift and hallucination risk.

No gold transcript exists; this is a divergence + targeted-accuracy study. For disputed
words, the arbiter is a panel: (a) isolated re-transcription of the ~10 s disputed window
(fresh context) by large-v3 and turbo, plus faster-whisper and Parakeet-TDT-0.6b (a
non-Whisper architecture) as referees; (b) scriptural/historical context (this is
verse-by-verse KJV commentary — for orthography-of-homophone disputes like Ahaz/Ahas,
audio cannot decide spelling and canonical context is the *correct* arbiter, not a
fallback). Excerpts are aligned by timestamp window, never by segment index.

## 1. Proper nouns / domain vocabulary — Whisper wins the canon; Deepgram wins the confusables

Slice window (1450–2350 s), all conditions:

| Name (correct per KJV/context) | Deepgram nova-3 + keyterms | Whisper v3 vanilla | Whisper v3 carry-prompt | Whisper turbo |
|---|---|---|---|---|
| **Ahaz** ×28 | "Ahas" ×28 — **0/28** | **28/28** | **28/28** | **28/28** |
| **Tiglath-Pileser** ×2 | "Tiglath Pelazar/Pelezar" — 0/2 | "Tiglath", "Tiglath-Pileser" — 1½/2 | **2/2** | **2/2** |
| **Urijah/Uriah** ×5 | "Eurejah" ×3, "Elijah" ×1, "your eye to" ×1 — **0/5** | "Uriah" ×5 — 5/5 (Uriah variant) | "Uriah" ×4, "Urijah" ×1 — **5/5** | "Uriah" ×5 — 5/5 |
| **Uzziah** ×1 | "Uzzar" — 0/1 | **1/1** | **1/1** | **1/1** |
| Assyrians/Syrians (near-homophones) | better | worse | worse | worse — slice-run WH went 0/3 on arbitrated windows; episode-level census: DG 2/3, WH 1/3 on divergent sites. See §Arbitration |

Full episode (3.6 h), all probe names, Whisper large-v3 vanilla vs Deepgram
(possessives folded in; ✓ = canonical spelling):

| Name | Deepgram + keyterms | Whisper v3 vanilla | Verdict |
|---|---|---|---|
| Ahaz | "Ahas" ×46 — 0 correct (a 47th "Ahas" token is part of the Jehoahaz garble below) | **"Ahaz" ×46 — 46/46** | Whisper ✓ |
| Hezekiah | 111 ✓ | 112 ✓ | parity ✓ (was keyterm-boosted) |
| Sennacherib | 8 ✓ + "Sennacher" ×1 | 9 ✓ | ~parity, Whisper edges it |
| Manasseh | 39 ✓ | 40 ✓ | parity ✓ (keyterm) |
| Josiah | 38 ✓ | 38 ✓ | parity ✓ (keyterm) |
| Nineveh | 1 ✓ | 1 ✓ | parity ✓ |
| Assyria/Assyrian(s) | 126 | 124 | parity (keyterm; see Syrians dispute) |
| Jehoahaz | **0** ("Jehoi" garble) | **1 ✓** | Whisper ✓ |
| Jehoash (2 Kgs 12) | "Jehoash" ×2, "Jehoiash" ×1 | "Jehoash" ×4 ✓ | Whisper ✓ |
| **Jehoiakim** | **0** — "Jehoiachim" ×11 | **16 ✓** | Whisper ✓ |
| **Jehoiachin** | **5** ("Jehoiachin"; ~4 clean sites — 1 sits in father-context) | **0 — wrote "Jehoiakim"** | **Deepgram ✓ — see below** |
| Urijah/Uriah | "Eurejah" ×3, "Elijah" ×1, "your eye to" ×1 — 0 | "Uriah" ×4 + "Urijah" ×3 ✓ | Whisper ✓ |
| Uzziah | "Uzziah" ×2 ✓, "Uzzar" ×1 — 2/3 | "Uzziah" ×3 — 3/3 ✓ | Whisper edges it |
| Tiglath-Pileser | "Pelazar/Pelezar" — 0 | rendered ✓ (once as bare "Tiglath") | Whisper ✓ |
| Zedekiah | 12 ✓ | 12 ✓ | parity ✓ (keyterm) |
| Nebuchadnezzar | 7 ✓ | 7 ✓ | parity ✓ (keyterm) |
| Asahiah (2 Kgs 22:14) | **"Assyria"** — person became an empire | "Ash-Sahiah" — garbled, but self-flagged (token p=0.5) | both wrong; Whisper's failure is closer + detectable |
| Naaman, Jehoiakim-era others | n/a — Naaman is in the 2 Kings 1–13 episode, not this one | n/a | not measurable here |

**The Jehoiachin catch — the one probe Whisper loses, and the honest headline nuance.**
The episode's hardest name pair is Jehoiakim and his son Jehoiachin (the speaker himself
says "sorry for the similarity in names here"). The two engines fail in mirror image:
Deepgram misspells the father ("Jehoiachim", 11×) but *preserves the distinction* between
the two kings; Whisper spells the father canonically (16×) but **renders the son as
"Jehoiakim" too** — producing self-nullifying text like "Jehoiakim is no different than
Jehoiakim" and destroying the father/son distinction at the source, where no alias layer
can recover it. faster-whisper (same weights, independent implementation) hears the same
thing, so this is a Whisper-model prior, not a decoding fluke; Deepgram (different model)
heard the "-chin" ending distinctly at 5 sites — though not perfectly: one of its
"Jehoiachin" tokens sits in father-context (2 Kgs 24:1, where Whisper's "Jehoiakim" is the
right king), and it once emitted "Jehoiada" (a priest from 300 years earlier) inside the
uncle sentence — so its clean son-sites number ~4, not 5. KJV context (2 Kgs 24:6, 24:17 —
Zedekiah is Jehoiachin's uncle) confirms the intended name is Jehoiachin at those sites.
Net: Deepgram's failure costs one alias entry; Whisper's costs entity identity for ~4–5
mentions of a minor king. Both are real defects; neither engine handles this pair cleanly.

Why this matters downstream: Whisper's spellings, when right, are *canonically* right (it
even produced the exact KJV variant "Urijah"), which is precisely what an entity-alias
layer wants. Deepgram's consistent misspellings (Ahas 46/46, Jehoiachim 11/11) are
aliasable — the workaround already shipped for Ahas — but carry a landmine: "Jehoiachim"
(its spelling of the father) is one letter from "Jehoiachin" (its spelling of the son), so
the alias table has to thread a needle between two entities. Deepgram's *inconsistent*
misspellings (Eurejah/Elijah/"your eye to" for one priest; "Assyria" for the person
Asahiah) are worse: lost or mis-typed mentions no alias can recover. Whisper's counterpart
defect is rarer but deeper — the Jehoiachin→Jehoiakim merge attaches one king's mentions
to the other king at the source (see Arbitration).

Breadth check: a further 20 boosted names were tallied across the full episode (Elijah,
Jehu, Samaria, Joash, Azariah, Jehoiada, Isaiah, Jeremiah, Babylon, Pharaoh, Egypt,
Jerusalem, Ahab, Moab, Gilead, Hebron, Lehi, Nephi, Moroni, Mormon): count-level parity on
17, and the deltas on the rest trace to *Deepgram* errors (its Elijah surplus includes the
Uriah misrecognition; one of its "Jehoiada" tokens appears inside a list of Exodus women
where Whisper wrote "Yocheved"). ~28 boosted names audited in total; the remaining ~70 in
the keyterm list were not individually checked.

### Did the prompt help Whisper?

- **Vanilla already solved the headline problem** (Ahaz 28/28 with no help).
- `--prompt` alone (first window only): **actively harmful** — it induced a
  repetition/hallucination event at ~1764 s (the sentence pair repeated ~5× consecutively,
  with ~59 s of coverage gaps — ~75–100 s of real content lost). Align-rate vs Deepgram
  fell 93.1% → 76.3%. Discarded from the full-episode runs.
- `--prompt --carry-initial-prompt` (true keyterm analog): **looked like the winner on the
  slice, failed at episode scale.** Slice: best align rate (95.2%), Tiglath-Pileser 2/2,
  produced the KJV "Urijah", zero hallucination indicators — and on the full episode it
  avoided both of vanilla's repetition events with the highest align rate of any run
  (97.4%). But the full-episode name tally exposed **prompt-induced substitution on two
  names that are in the prompt**: Manasseh → "Manaessah" ~9 of 37 sites and Zedekiah →
  "Zechariah" (a *different* biblical person, also in the prompt) 4 of 12 sites — vanilla
  got both 100% right. It also downgraded Urijah (1× vs vanilla's 3×). The slice window
  contains zero Manasseh/Zedekiah mentions, so the slice could not have caught this — a
  clean demonstration of why single-window validation is insufficient. **Do not use carry
  without per-name re-validation; the recommended config is vanilla.**

## 2. Word-timestamp fidelity — parity for pipeline purposes

Method: normalize (case/punct/digitspoken numbers), sequence-align both word streams,
score only exact 1:1 matches; estimate the constant decode-chain offset (median delta) and
report dispersion around it. RMS is deliberately not used (outliers from disfluencies would
dominate).

Slice, large-v3 vanilla vs Deepgram (2,486 matched words = 93.1%):

| Metric | Value |
|---|---|
| Global constant offset (Whisper later) | +65 ms |
| Median abs deviation after offset removal | 60 ms |
| p95 abs deviation | 185 ms |
| within ±100 ms | 73.5% |
| within ±200 ms | 95.8% |
| within ±500 ms | 99.5% |

Carry-prompt: statistically identical (median 60 ms, 95.4% ≤200 ms). Turbo: slightly
looser (offset +145 ms, median 75 ms, 92.7% ≤200 ms) but still within one short word.

The +65 ms constant belongs to the decode chain (AAC priming/edit-list handling differs
between ffmpeg and Deepgram's ingest) and DTW's known slight late bias — it is not drift,
and a pipeline could subtract it wholesale. ffprobe duration of the ffmpeg-decoded wav
matches Deepgram's `metadata.duration` to 1 ms (12,991.727 vs 12,991.728), so there is no
cumulative clock mismatch.

**Full-episode drift check: flat.** Over 3.6 h and 35,017 matched words (96.4% align
rate), per-15-minute median deltas stay in a 55–76 ms band with no slope
(0–15 min: 65 ms → 210–225 min: 76 ms, wandering not accumulating). Whole-episode:
median dev 60 ms, 94.3% within ±200 ms, p95 210 ms — indistinguishable from the slice.
Whisper's 20 ms DTW grid does not drift against Deepgram's aligner over hours.

**faster-whisper referee (slice): DTW validated.** Each implementation carries its own
constant bias vs Deepgram (whisper.cpp DTW: +60 ms late; faster-whisper: −180 ms early —
it absorbs leading silence into word starts), but after offset removal the dispersion is
equivalent: fw-vs-Deepgram median dev 50 ms / 88.9% ≤200 ms, whisper.cpp-vs-Deepgram
60 ms / 95.8% ≤200 ms, fw-vs-whisper.cpp 80 ms / 82% ≤200 ms. No implementation is an
outlier; constant bias is irrelevant when one engine is used consistently. (Referee ran
CPU-only at 1.0× realtime — also confirming faster-whisper is not a viable bulk engine on
macOS.)

Granularity note: Deepgram word times are ms-resolution onsets from its aligner; whisper.cpp
DTW times sit on a 20 ms grid. Both are word-start anchors; for "mention → timestamp"
anchoring, both are comfortably inside the tolerance any UI seek or span-highlight needs.

## 3. Spoken numbers / verse references — effectively identical

In the slice window the two engines rendered every verse/chapter reference **identically**,
including the same digit-vs-word choices ("Verse 23" as digits, "verse seven and eight"
spelled out, "chapter 16" as digits):

- Whisper: `2× chapter 16, Verse 15/19/22/23, verse 10/12/14/20, verse seven and eight`
- Deepgram: same list, same forms.

Both engines run inverse text normalization with similar thresholds (small/ordinal numbers
spelled out, larger ones as digits). The existing verse-ref parser already handles both
forms, so **switching engines would not change parser requirements**. One systematic
difference: Whisper normalizes spoken "Second Chronicles" → "2 Chronicles" where Deepgram
keeps the verbatim "Second Chronicles"; both parse to the same book. Full-episode tally
(identical regex over both transcripts, verse/chapter refs): Whisper 140 digit / 44 word
(76% digit) vs Deepgram 112 / 74 (60% digit) — Whisper leans harder on digits (more
parser-friendly, less verbatim); no verse reference was *lost* by either engine in any
sampled window.

## 4. Segmentation

| | Deepgram (utterances) | Whisper large-v3 (segments) |
|---|---|---|
| Count, slice window | 200 | 160 |
| Mean duration | 4.0 s (3.7 s episode-wide) | 5.4 s |
| Ends on terminal punctuation | 56% (slice) / 49% (episode) | 31% (slice) / 48% (episode) |
| Word-level times inside | yes (words[]) | yes (DTW tokens) |

Neither segments on clean sentence boundaries; both are acoustic-pause-driven. In the
name-dense slice window Whisper's segments ran longer and less punctuation-aligned; at
episode scale the two segmenters converge (Whisper 4,153 segments, mean 3.0 s, 48%
terminal-punct vs Deepgram 3,045 utterances, mean 3.7 s, 49% — effectively parity). Since
the extraction pipeline anchors to word timestamps rather than segment identity, this is
cosmetic — but any consumer that treats utterances as quotable units would need
re-chunking under either engine.

## 5. Speed / cost

Hardware: Apple M5 Pro, 18-core, 48 GB unified, Metal. Audio: 900 s slice (RTF = audio
seconds per wall second; model load excluded, first-run Metal warm-up discarded).

| Config | Wall (900 s audio) | RTF |
|---|---|---|
| large-v3, `-nfa --dtw` (quality config) | 84.7 s | **10.6×** |
| large-v3 + carry-prompt, `-nfa --dtw` | 91.9 s | 9.8× |
| large-v3, flash-attn, no DTW | 75.9 s | 11.9× |
| large-v3-turbo, `-nfa --dtw` | 26.0 s | **34.6×** |
| large-v3-turbo, flash-attn, no DTW | 20.6 s | 43.7× |

Full 3.6 h episode (12,991.7 s):

| Config | Wall | RTF |
|---|---|---|
| large-v3 vanilla, quality config | 1,286.7 s (21.4 min) | **10.1×** |
| large-v3 carry-prompt (CPU referee running concurrently) | 1,262.2 s | 10.3× |
| large-v3-turbo, quality config | 362.7 s (6.0 min) | **35.8×** |

Linear with the slice — no long-form slowdown. The whole 10-episode back-catalog (~47 h of
audio) would be ~4.6 h unattended on large-v3 or ~1.3 h on turbo.

Cost comparison: Deepgram at ~$0.0077/min ≈ **$1.66 per 3.6 h episode** (~$16.70 for the
10-episode back-catalog). Local Whisper: $0 marginal, ~21 min of M5 Pro time per episode at
10.6× (or ~6 min with turbo). A 50-episode season: ~$83 Deepgram vs ~18 h (v3) / ~5 h
(turbo) of unattended local compute.

## 6. Hallucination / long-form robustness

- The `--prompt`-only condition produced a real repetition loop + ~75–100 s content drop on
  the slice (documented above) — evidence that prompting is not free.
- Vanilla and carry-prompt slice runs: no repetition loops, no large divergent spans.
- Full episode (3.6 h), vanilla v3 scan results:
  - **Sustained n-gram loops: zero** (no 5-gram repeated ≥3× consecutively anywhere).
  - **Repetition event 1** (minute 112, ~6,745 s): Whisper repeated the quoted prayer
    sentence "O Lord our God, I beseech thee, save thou us out of his hand…" (~34 words
    duplicated) and dropped the word "monotheism". Caught automatically by a
    words-per-minute anomaly scan (227 vs 151 wpm).
  - **Repetition event 2 — end-of-audio, and it evaded the scans.** After the last real
    sentence (~12,968 s), vanilla emitted "Come unto Christ." four times over the outro
    (12,986–12,989 s; Deepgram has it once). Three words repeated 4× is under the 5-gram
    loop threshold and +12 words is under the wpm threshold — only direct inspection of
    the final segments caught it. Classic Whisper outro-music behavior, mild here.
  - **Low-confidence self-flagging works**: only 4 segments in 3.6 h had mean token
    probability < 0.5, and one of them is the garbled "Ash-Sahiah" (Asahiah) — i.e.
    Whisper's token probabilities localize its own worst moments, which Deepgram's
    per-word confidences did not do for "Ahas" (confidently wrong).
  - Practical implication: the cheap scans caught one of the two events; a production QA
    pass needs, in addition: an explicit end-of-audio check (compare last-segment time vs
    audio duration; flag repeated short phrases in the final minute) and a short-phrase
    (2–4-gram) repeat detector. Name-level defects (Manaessah, Eurijah) pass all
    transcript-level scans — entity-level QA (known-name fuzzy match) is the missing layer.
- Full episode, carry-prompt and turbo scans: zero n-gram loops, zero wpm anomalies, zero
  low-probability segments, and neither reproduced vanilla's two repetition events. But
  "scan-clean" is not "defect-free": the carry run's Manaessah/Zechariah substitutions and
  turbo's Eurijah/Sennachera garbles (§1) are invisible to these scans. Prompt-carry
  stabilizes *decoding* while distorting *lexical choice* — the two failure axes are
  independent.

## Arbitration of disputed words

Panel: isolated re-transcription of the disputed ~10 s window with fresh context
(large-v3, turbo, faster-whisper large-v3, Parakeet-TDT-0.6b), plus KJV/historical context.
All Whisper-family referees share weights — they cross-check *implementations and context
effects*, not the model; Parakeet is the independent architecture. For homophone spelling
(Ahaz/Ahas, Uriah/Urijah), audio cannot arbitrate and canon is the arbiter.

| Time | Phrase | Deepgram | Whisper v3 (in context) | Verdict + evidence |
|---|---|---|---|---|
| 1572 s | "next time the Israelites or the Edomites or the ___ attack us" | Syrians | Assyrians | **Syrians** — DG right. Attackers were Rezin of Syria + Israel + Edom (2 Chr 28); Assyria was the protector being hired. v3-isolated flips to "Syrians". |
| 1771 s | "The Assyrians do attack the ___" | Syrians | Assyrians | **Syrians** — DG right. 2 Kgs 16:9, Assyria sacks Damascus. Whisper's in-context "Assyrians attack the Assyrians" is self-refuting; v3-isolated flips to "Syrians". |
| 2197 s | "you want a ___ altar?" | "a Assyrian" | Syrian | **Assyrian** — DG right (verdict revised by the panel). Parakeet: "an Assyrian altar"; turbo-isolated agrees; v3 alone says "Syrian" (2 votes of 5). Contextually coherent either way — Ahaz copied the altar while visiting the *Assyrian* king at Damascus (2 Kgs 16:10) — so the panel majority decides. |
| 2230 s | "the new one … the one that ___ built" | Elijah | Uriah | **Urijah** — WH right. The altar-builder is Urijah the priest (2 Kgs 16:11); Elijah is chronologically impossible. v3-isolated and Parakeet: "Urijah"; turbo-isolated: "Uriah". |
| — | Ahaz/Ahas ×46 (episode) | Ahas | Ahaz | **Ahaz** — orthography of homophones; KJV canon decides. "Ahas" is not a biblical name. |
| 12,015 s + 4 more | "succeeded by his son ___" / "___'s uncle" | Jehoiachin | Jehoiakim | **Jehoiachin** — DG right at the ~4 clean son-sites. All Whisper-family decoders (v3 in-context, v3 isolated, faster-whisper) flatten both kings to "Jehoiakim", but Parakeet — an independent architecture — cleanly hears two names ("his son Jehoiakin… Jehoiakin is no different than Jehoiakim"), eliminating the speaker-slip hypothesis. A genuine Whisper *model* failure, not a decode artifact. |
| 10,387 s | "Hilkiah the priest, Ahikam, Achbor, Shaphan, ___" | "Assyria" | "Ash-Sahiah" | **Asahiah** (2 Kgs 22:14). Both wrong; Deepgram promoted a person to an empire (worse for entity typing), Whisper garbled the surface form but flagged it (token p = 0.5). |

**Scorecard after the full panel (including Parakeet-TDT, the independent architecture —
all engines' window transcriptions are in `out/disputes_all_engines.json` and
`out/parakeet_disputes.json`):**

- **Acoustically-confusable pairs: Deepgram is better, but it is an edge, not a sweep.**
  On the arbitrated slice windows the slice-run Whisper went 0/3 on Syrians/Assyrians;
  but a full-episode census of *divergent* Syrian/Assyrian sites in the run that matters
  (vanilla full) finds exactly 3: Deepgram right at 1,771 s and 2,197 s, **Whisper right
  at 6,347 s** (2 Kgs 7 siege of Samaria — "the Syrians heard" per KJV 7:6; Deepgram wrote
  "Assyrians"). And at 1,572 s the full run rendered "Syrians" correctly where the slice
  run had erred — Whisper's answer at a given timestamp depends on decode context.
  Episode ledger: **DG 2/3, WH 1/3**, plus Deepgram alone preserving Jehoiachin (~4 clean
  sites). nova-3's acoustic discrimination on confusable pairs is genuinely better;
  Whisper's language-model prior steamrolls fine phonetic differences.
- **Canonical-orthography class (Ahaz, Urijah, Uzziah, Tiglath-Pileser, Jehoiakim,
  Jehoahaz, Jehoash, Asahiah-ish): Whisper wins every probe**, and Parakeet's readings
  ("Ahaz", "Urijah") consistently corroborate Whisper's spellings, not Deepgram's.
- Downstream, regardless of engine: treat Syria/Assyria-adjacent mentions and
  similar-name king pairs as low-confidence; that class needs contextual resolution, not
  a better transcriber.

## Side-by-side excerpts (same timestamp window, both engines)

### 1. ~1571–1578 s — the headline defect + a dispute in one breath

> **Deepgram:** "…the next time the Israelites or the Edomites or the **Syrians** or anyone
> else attacks us. Let's get on Assyria's good side. **Ahas** says to this Assyrian…"
>
> **Whisper v3 (slice run):** "…the next time the Israelites or the Edomites or the
> **Assyrians** or anyone else attacks us. Let's get on Assyria's good side. **Ahaz** says
> to this Assyrian king,"

Each engine gets one right: Deepgram wins "Syrians" (arbitrated), Whisper wins "Ahaz"
(canon). Footnote on decode-context sensitivity: the *full-episode* Whisper run rendered
this same window correctly ("Syrians") — the error above belongs to the slice run.

### 2. ~1556–1560 s — Assyrian king's name

> **Deepgram:** "This is where we get on the good side of Tiglath **Pelazar**…"
>
> **Whisper v3:** "This is where we get on the good side of Tiglath-**Pileser**…"

Tiglath-Pileser III — Whisper canonical, Deepgram phonetic gibberish.

### 3. ~2024–2036 s — the priest

> **Deepgram:** "**Ahas** sends the plans back to **Eurejah**, the priest…"
>
> **Whisper v3:** "**Ahaz** sends the plans back to **Uriah**, the priest…"

Both of Deepgram's names here are non-entities for the alias layer.

### 4. ~1782–1790 s — verse reference + book naming

> **Deepgram:** "So look at **second Chronicles 28 verse 20**. The king of Assyria came unto…"
>
> **Whisper v3:** "So look at **2 Chronicles 28, verse 20**. The king of Assyria came unto
> him, to Ahaz, and distressed him, but strengthened him not."

Same verse ref semantics; Whisper normalizes "second"→"2"; both quote KJV cleanly.

### 5. ~1764–1840 s — the prompted-run failure (three-way)

> **Deepgram (correct):** "…I accept Judah's offer… we took it from the north… then attacked
> them later anyway… he distressed him, he strengthened him not… like the death of Koroh…"
>
> **Whisper v3 vanilla (correct, same content):** aligns with Deepgram throughout.
>
> **Whisper v3 `--prompt` only:** "…if we knew our true identity as sons and daughters of
> God, then we wouldn't succumb to the kinds of wiles… *(the sentence pair repeats ~5×
> consecutively; ~59 s of audio coverage gaps; ~75–100 s of real content missing)*"

The reason the naive prompt condition was discarded.

### 6. ~12,011–12,022 s — the two-kings problem, in one line each

> **Deepgram:** "When **Jehoiachim** then dies, he's succeeded by his son **Jehoiachin**.
> Sorry for the similarity in names here. But **Jehoiachin** is no different than
> **Jehoiachim**…"
>
> **Whisper v3:** "When **Jehoiakim** then dies, he's succeeded by his son **Jehoiakim**.
> Sorry for the similarity in names here. But **Jehoiakim** is no different than
> **Jehoiakim**…"

Deepgram: wrong spelling for the father, but two distinct kings. Whisper: canonical
spelling, but one king where there are two — the sentence destroys its own meaning.
(KJV: father Jehoiakim, son Jehoiachin.)

## Colloquialism / verbatimness (readability, minor)

Whisper normalizes: "gonna"→"going to", "wanna"→"want to", "gotta"→"got to",
"'cause"→"because" (~12 instances in the slice). Deepgram transcribes verbatim, including
disfluency repeats ("do tack do attack"). For a transcript-reading UI Deepgram is more
faithful to the speaker's voice; for extraction it is irrelevant. Neither affects entities
or verse refs.

## Bottom line

**Could local Whisper replace Deepgram for future shows? Yes — and for this pipeline it
would be an upgrade, not a lateral move.** Dimension by dimension:

1. **Proper nouns (top priority): Whisper (vanilla) better where it matters most, with
   one honest loss.** It fixes the exact failure class that forced the alias workaround
   (Ahas→Ahaz), plus four more of the same kind (Eurejah, Pelazar, Uzzar, Jehoiachim), and
   its errors skew toward *canonical* spellings — what an entity-alias layer wants. The
   keyterm boost Deepgram had did not, in practice, protect any name that Whisper missed:
   the ~28 boosted names audited came out at parity, and the names Deepgram flubbed were
   the unboosted ones Whisper already knew. The loss: on acoustically-confusable pairs,
   Deepgram hears better — 2/3 on the episode's divergent Syrians/Assyrians sites, and it
   kept Jehoiakim/Jehoiachin distinct where Whisper merged them. Episode tally of damaged
   mentions: Deepgram ~57 aliasable (Ahas 46, Jehoiachim 11) + ~14 unrecoverable
   (Eurejah ×4, Elijah-for-Uriah, "your eye to", Pelazar ×2, Uzzar, Jehoi, Jehoiash,
   Assyria-for-Asahiah, 1 Syrians-site, Jehoiada-in-women-list) vs Whisper vanilla ~9
   unrecoverable (Jehoiachin-merge ~5, 2 Syrians-sites, Ash-Sahiah, bare-Tiglath ½).
2. **Timestamps: parity.** Subtract one constant per-engine offset and both anchor 94–96%
   of words within ±200 ms of each other, with zero drift over 3.6 h — validated against a
   third implementation. Nothing downstream would notice the switch.
3. **Numbers/verse refs: parity.** Same ITN behavior, same parser requirements; Whisper is
   slightly more digit-leaning ("2 Chronicles" vs "Second Chronicles").
4. **Segmentation: wash.** Different unit (segment vs utterance), same mid-sentence
   breaking; word-level anchoring makes it moot for extraction.
5. **Speed/cost: Whisper wins on cost, loses nothing that matters on speed.** $0 and 21
   min/episode unattended (or 6 min on turbo) vs $1.66 and an upload. Deepgram's remaining
   advantages are operational (no local hardware tied up, SLA) — not quality.
6. **Hallucination: real, small, and only partly self-detecting.** Two repetition events
   in the vanilla 3.6 h run (~34 words at minute 112; "Come unto Christ" ×4 over the
   outro), zero in carry/turbo. The shipped scans caught one of the two; the end-of-audio
   event required direct tail inspection, and name-level defects (Manaessah, Eurijah) are
   invisible to transcript-level scans entirely. Any adoption should ship the scans in
   `out/fullscan_*.json` *plus* an end-of-audio check and an entity-level fuzzy-match QA
   against the known-names table.

**Recommendation.** For future shows: transcribe locally with **large-v3 vanilla**
(`-nfa --dtw large.v3`, no prompt), run the QA scans, and keep Deepgram as a fallback for
episodes the scans flag. Do not use `--carry-initial-prompt` without per-name
re-validation: it fixed nothing vanilla needed fixing and corrupted two prompted names at
episode scale (Manaessah ×9, Zechariah-for-Zedekiah ×4). Turbo is a legitimate
throughput option but is not free: beyond looser timestamps (92% vs 94% within ±200 ms)
it produced two Deepgram-class garbles ("Eurijah" ×2, "Sennachera") that large-v3
avoided — spot-check names if using it. For the existing back-catalog: the transcripts
are already paid for; the argument for re-transcription is entity quality (Ahaz-class
fixes across 10 episodes for ~4.6 h of unattended compute) — worth it if/when alias-layer
pain recurs, not urgent otherwise. The next real decision point is the next show ingest;
nothing in this eval blocks using Whisper for it.

**Scope caveats, stated plainly:** single episode, single speaker, one genre; the
confusable-pair conclusions rest on 3–5 sites; four of the five arbitration engines share
Whisper weights (Parakeet is the only independent architecture); "align rate" uses
normalized text (digits↔words, punctuation folded) and a non-WER denominator, so it
measures agreement, not accuracy; and slice-run vs full-run outputs differ at identical
timestamps (decode context), so table cells are labeled by run where it matters.

## Reproduction

- Raw outputs: `docs/ops/whisper-vs-deepgram/out/` (gitignored; large JSON). Includes the
  three full-episode runs, four slice runs, `fullscan_*.json` analysis summaries,
  `disputes_all_engines.json` (every panel engine's transcription of each disputed
  window), `parakeet_disputes.json`, and `timings-orchestration.log` (the wall-clock
  source for the RTF table).
- Models: ggml large-v3 (3.1 GB), large-v3-turbo (1.6 GB) — not committed.
- Scripts: `analyze.py`, `fullscan.py`, referee scripts, `prompt.txt`, `keyterms.txt`
  (99 usable entries after dropping a junk "NA" row) alongside the raw outputs in `out/`.
- Referee caveat: faster-whisper ran int8 on CPU (a quantization the whisper.cpp runs do
  not have) — acceptable for a timestamp referee, would not be for a quality referee.
- Deepgram reference untouched; DB access read-only (keyterm list reproduction).
- Adversarially reviewed against the raw data by a second agent; all quantitative claims
  above reflect post-review corrections.
