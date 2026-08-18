# Transcription bake-off — Deepgram nova-3 vs WhisperX (Stick of Joseph)

2026-08-18. Decides the engine for the 58-episode SoJ fleet
(docs/design/second-show.md §6). Test material: the validation trio.
YouTube's own auto-captions ride along as a third witness for
disagreement arbitration on the Todd episode.

| Episode | Role | Duration | Deepgram result |
|---|---|---|---|
| 63onrrP5Tz4 (Todd interview) | modal case, 2 speakers | 1:01:51 | 842 utterances, 2 speakers, 72/28 talk-time |
| LXoi1I_TQAk (launch panel) | diarization stress, 4+ | 1:42:41 | 1,054 utterances, 4 dominant speakers (35/28/20/14) + three ~1% voices |
| JM6ILq8hkyE (padded lecture) | dead air | 1:50:19 | 1,518 utterances, lecturer 67% / co-presenter 24% / Q&A tail |

Deepgram run: nova-3, `diarize: true`, 100 keyterms (DB-derived),
`__params` fingerprint in each artifact. Billed 16,491 s ≈ $1.18.

## Findings — Deepgram

**Diarization is usable as shipped.** The interview resolves to exactly
2 speakers. The panel finds the 4 real panelists and correctly gives the
stray voices (audience, crosstalk) ~1% each. The lecture nominally reports
9 speakers but 96% of talk-time sits in the real 3; the tail is noise.
Since we render speaker TURNS, not identities, over-detection in the tail
costs nothing visible.

**Dead air is a non-issue at load time.** The padded lecture carries its
pad up front (a 100.6 s silent gap 13.7 s in), not at the tail — last
utterance ends 6,611.6 s of 6,619 s, inside even the default tolerance.
`validateUtterances` only gates the tail, so nothing in the trio would
fail the fleet. `tailToleranceS: 900` stays as insurance for episodes we
have not sampled.

**Scripture register is strong.** On the Todd episode, Deepgram vs
YouTube auto-captions: Melchizedek 3/3 vs 0/3 (YouTube missed every one);
"telestial" 10 correct vs 0 (YouTube folded them into "celestial");
Helaman 1 vs 0. This vocabulary is the product — chapter search moments
and future entity extraction die on an engine that cannot hear it.

**The host's name — a cautionary loop.** Baseline Deepgram produced
"McLaughlin" (2×) and once "Tom" for "Todd"; YouTube produced
"Tom McLaclin". The research had concluded the host spells it
"McLauchlin" (all nine of the channel's own video titles use that
spelling), so a keyterm biased Deepgram to it. **Abram then ruled the
man's real spelling is McLaughlin** — the channel titles are themselves
misspelled, and the original "baseline error" was Deepgram being right.
Keyterms now carry `Todd McLaughlin`; run 4 produces McLaughlin 2/2,
Todd 6/6, zero "Tom". Lessons: keyterms steer spelling with total
authority (both directions), channel metadata is not ground truth for
names, and the `__params` fingerprint records keyterm COUNT only — a
keyterm CONTENT change needs the artifact deleted to force a re-run.

## Findings — WhisperX (large-v3, int8, batch 4, CPU)

**Speed: 20m13s wall (2h01m CPU) for the 62-minute episode. Deepgram did
the same file in 20 seconds.** CTranslate2 has no MPS path, so on this
class of hardware WhisperX runs ~0.3× realtime with the machine loaded;
the 78.5-hour fleet would be roughly 26 hours of continuous compute vs
~35 minutes of Deepgram wall time for ~$20.

**Accuracy is comparable — and it found a real Deepgram weakness.**
Word-level disagreement after style normalization (fillers, contractions,
number format): ~5.7%, and 410 of 473 raw diff hunks were 1–2 words of
style, not content. On the scripture register the engines tie
(Melchizedek 3=3, Nephi 5=5, Moroni 3=3). But WhisperX resolved the
telestial/celestial minimal pair correctly at 5 sites where Deepgram
heard "celestial" — readings that inverted the speaker's meaning
("transactional covenants … the mode of the telestial world"), plus one
garbled "Telestral". Argument context confirms WhisperX at every
contested site.

**The keyterm mechanism closed that gap.** Adding `telestial` to
`extraKeyterms` and re-running: Deepgram now agrees with WhisperX at all
5 sites (16/6 telestial/celestial — identical counts), zero garbled
forms, names still correct. WhisperX has no equivalent lever — its
`initial_prompt` biasing is weak and capped. On the name it did not
need one: it produced "McLaughlin" unprompted, which Abram confirmed
correct after the config had bet on the channel's spelling.

**No diarization without a HuggingFace token** (pyannote gating), which
this machine does not have. Deepgram's is one request parameter and
resolved all three episode shapes correctly.

**Remaining disagreements are adjudicable by ear**: 164 material sites,
published as an interactive judging page (audio snippet + both readings
+ verdict buttons per site) so the human pass is cheap.

## Human adjudication (2026-08-18, in progress)

The 164 material disagreement sites went to Abram as an interactive
audio-judging page. First pass: **the first 14 sites went to WhisperX
without exception.** Cross-check with YouTube's transcript as a third
witness across all 164 sites: where the witness can arbitrate (63
sites), it sides with WhisperX 42 / Deepgram 21 — two to one, stable
across the whole hour. On disputed running speech, WhisperX large-v3
hears this show better; the earlier "accuracy ties" read was based on
vocabulary counts, which do tie, but the tie does not extend to
conversational content.

## Verdict — UNDER REVISION

The accuracy edge belongs to WhisperX; the operational edge (20s vs 20m
per audio-hour, built-in diarization, keyterm spelling control, existing
pipeline) belongs to Deepgram. Fleet engine is Abram's call; the
recommended split is WhisperX for the pitch-critical collections (Todd,
panels) and Deepgram for the rest. Record the decision here when made.

Run ledger: Todd episode transcribed 4× (baseline, +names,
+telestial, McLaughlin correction), panel and lecture 3× each =
$3.83 total, all artifacts fingerprinted with `__params`.
