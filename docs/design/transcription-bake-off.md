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

**The one real miss: the host's name.** "McLauchlin" came back as the
common spelling "McLaughlin" (2×) and once as "Tom" for "Todd". YouTube
did worse ("Tom McLaclin" 2×). Cause: the keyterm list was DB-derived
canon names only. Fixed in the same session: per-show `extraKeyterms`
(host names, show names) now take the head of the keyterm list, and the
trio was re-transcribed with it — Todd 6/6, McLauchlin 2/2, zero wrong
spellings across all three episodes. Display names never depended on
this (they come from config), but transcript search does. Note the
`__params` fingerprint records keyterm COUNT only, so a keyterm CONTENT
change needs the artifact deleted (or moved) to force a re-run.

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
`initial_prompt` biasing is weak and capped — so "McLauchlin" stays
misspelled there while keyterms fixed it in Deepgram.

**No diarization without a HuggingFace token** (pyannote gating), which
this machine does not have. Deepgram's is one request parameter and
resolved all three episode shapes correctly.

**Remaining disagreements are adjudicable by ear**: 164 material sites,
published as an interactive judging page (audio snippet + both readings
+ verdict buttons per site) so the human pass is cheap.

## Verdict

**Deepgram nova-3, with per-show `extraKeyterms`, runs the fleet.**
Accuracy ties WhisperX once keyterms carry the show vocabulary; keyterms
are also the only mechanism that fixes proper-noun spelling (McLauchlin),
which transcript search depends on. Diarization is built in. The speed
and cost gap (20s vs 20m per hour of audio; ~$20 for the fleet vs ~26h
of CPU) is structural, and the pipeline already exists. WhisperX earned
its keep as the adversarial witness: the telestial keyterm exists because
of it. Keep this bake-off pattern for future shows whose register
differs.

Run ledger: trio transcribed 3× (baseline, +names, +telestial) =
$3.54 total, all artifacts fingerprinted with `__params`.
