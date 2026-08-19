---
name: principle-essay
version: 0.4.1
description: Activates when writing or revising a principle essay for Lintel — the long-form doctrinal entries on /principles/:id that replace the one-line descriptions. Encodes the house voice as a single measured specification (concrete register, reserved short sentences, definitions flat and inferences hedged), the citation discipline, and the specific AI-prose tics that get these rejected. Evidence comes from four measured corpora — Jared Halverson, Todd McLaughlin and Andrea Woodmansee for the teaching tradition, and Mike Day's written prose as the control for how that tradition behaves on a page. Use for any doctrinal prose that ships to readers, including collection summaries.
allowed-tools: Read, Write, Edit, Bash, Grep
---

# principle-essay

The essays are the product. A reader who wants a definition has a dictionary;
what Lintel owes them is an explanation that leaves them understanding the
doctrine better than when they arrived.

Read `teaching-patterns.md` in this directory before drafting. It is the
reference dictionary — definition patterns, scaffold shapes, transition
vocabulary, the full tic blocklist, and the verbatim model passages, each
attributed to the teacher it came from. This file is the method; that file is
the evidence.

## The voice

**There is one voice.** *(Collapsed in 0.4.0 from four personas. See "Why one"
below.)* It is not a teacher to imitate. It is a specification, and every line
of it is checkable against a draft:

1. **Register: concrete.** Abstract nouns (*structure*, *domain*, *order*,
   *principle*, *framework*, *system*, *process*) at or below parity with
   concrete ones (*bread*, *stone*, *door*, *water*, *field*, *feet*). Rule 1.7
   and tic 7 are the enforcement.
2. **Sentence: median 16–18 words, mean 20–22.** Short sentences are reserved,
   spent in runs of three or four at a paragraph's close, and the mechanics of
   speech return exactly once, in the final paragraph (1.10).
3. **Definition: one short sentence, present tense, verb *is* or *means*** —
   plainer and shorter than the essay's own opening sentence (1.4).
4. **The core move: build a working machine out of concrete parts, then run
   scripture through it.** The **sharpened reading and its evidence** fall out
   of the mechanism rather than being announced and then illustrated (2.5).
   Note what this does *not* say: the doctrine itself may be stated flat in
   sentence one. What the machine earns is the reading, not the topic (item 7).
5. **Authority: definitions stated flat, inferences hedged.** One posture, held
   for the whole essay (3.3).
6. **The *we* is self-implicating** and would break if swapped for *you* (3.1).
7. **Withholding operates on the evidence, not on the claim.** The doctrine can
   sit in sentence one; the sharpened reading and its evidence cannot (2.2).

An essay that satisfies all seven is in voice regardless of which teacher it
happens to resemble. An essay that resembles a teacher but misses these is not.

### Why one, and not four

v0.2.0 and v0.3.0 cast the essay per subject — Halverson for narrative,
McLaughlin for system terms, Woodmansee for ritual objects. Measurement does not
support that casting, and a product with a rotating voice is worse than one with
a plain one.

**At the sentence level the three spoken teachers are indistinguishable.** Mean
14.4 / 13.8 / 14.1 words. Median 12 / 10 / 10. Sentences under six words 21.9% /
24.6% / 25.0%. A 0.6-word spread in the mean is one voice measured three times,
not three voices.

**What looked like three styles is mostly three syllabi.** The words that most
separate them are Israel, Elijah, Joshua, Samuel (Halverson); bride, wedding,
virgins, door (Woodmansee); light, order, priesthood, endowment (McLaughlin).
The first is Old Testament content and the second is the ten virgins. Put
Halverson on that parable and he says *bride* too. Those are facts about what
each was assigned, not about how either teaches.

**One real distinction survives, and it is register.** Abstract-to-concrete noun
ratio: Halverson **0.1:1**, Woodmansee **0.2:1**, McLaughlin **7.7:1**. A
fortyfold gap, and the only line in the corpus wide enough to be a genuine
choice. Two of the three sit on the concrete side, tic 7 sits there, and
CLAUDE.md's "plain and honest" sits there. So the voice sits there.

**McLaughlin's method survives the collapse; his diction does not.** His borrowed
machines are already concrete — entropy, a social contract, an aviation
checklist. What drives his 7.7:1 is the naming vocabulary he wraps them in:
*domain*, *structure*, *order*, *principle*. Keep the machine. Drop the nouns.
That is item 4 above, and it is the best single technique in the corpus.

## Where the evidence comes from

The four corpora are no longer a cast. They are the evidence layer, and they
stay for one reason: **a voice described in prose cannot be checked, and an
unfalsifiable voice instruction produces nothing.** v0.1.0 named C. S. Lewis as
a target with no Lewis corpus to check against, and "write like Lewis" produced
nothing measurable — which is why he was retired in 0.2.0. Every rule below
carries a count or an attributed quotation so the same thing cannot happen to
"the Lintel voice."

**Jared Halverson** (Unshaken), **Todd McLaughlin** and **Andrea Woodmansee**
(Stick of Joseph) — ~145k words each of transcribed **speech**. They establish
what the teaching tradition does: grading the received reading, the inline
gloss, the deferred question, the self-implicating *we*.

**Mike Day** (ldsscriptureteachings.org) — the **written control**, and the
reason 0.3.0 was possible. 31,373 words of his own written prose sit beside
24.6k words of his own audited speech, so holding the teacher constant and
changing only the medium separates the tradition from the microphone. Anything
in both his modes is the tradition and ports. Anything only in the spoken
corpora was breath, and several 0.2.0 rules were built on breath.

Two standing cautions on the control. His prose is **unproofed** — real errors
survive publication ("a multiplicity of diving beings"), his longest sentence
runs 146 words, one essay has a 374-word paragraph. Take the *shape* of his
distribution and the *direction* of every shift from speech; never the
amplitude. And he never solved the block-quote problem — in several posts the
quoted material outruns his own five to one, which is the one thing to refuse
outright (2.8).

## The thing to get right first

The obvious reading of these three is that they share warmth. That reading
produces bad imitations, because warmth is the **output** of their method, not
the method.

What they actually share is **withholding**. All three defer the payoff.
McLaughlin builds for two hundred words before naming what he built: "Okay, so
this is the idea of covenant." Woodmansee stacks two questions and refuses to
answer them: "I think we get a hint of our answer in the next verses."
Halverson front-loads the frame and back-loads the point.

Every signature device below — the fragment landing, the voiced objection, the
etymology, the extended analogy — is a mechanism for making the reader wait,
and then for making the arrival **smaller and plainer than the wait**. Get the
withholding right and the warmth follows. Port the warmth without the
withholding and you get an essay that sounds enthusiastic about nothing in
particular.

**Demoted in 0.3.0, from thesis to technique.** The written control does not
support withholding as the master key. Day's written openings are **thesis-first
in roughly 12 of ~31 posts** — flat, declarative, no hook: *"Monolatry is all
over the text of the Old Testament."* Genuine deferral happens three times, and
one of those is a refusal to answer at all. **Not one essay opens on a scene.**

The reason is mechanical: a listener cannot skip, so speech enforces the tension
for free. A reader can leave, and a reader who stays can scroll. So on a page
the withholding operates on the **evidence**, not on the **claim**. What
generalizes is step 3 of 2.1, the prerequisite build. What does not generalize is
suppressing the thesis.

Keep the second sentence of the paragraph above — *the arrival is smaller and
plainer than the wait* — because that half is confirmed in writing. Drop the
assumption that the reader must not know where the essay is going.

---

# Pass 1 — Diction

Run this pass on the words. Everything here is countable; if a rule cannot be
checked by counting or by deletion, it does not belong in this pass.

**1.1 — The register is concrete, and it is not a choice.** *(Was "pick one
register"; settled in 0.4.0.)*
Objects, not mechanisms. Shoes, bread, hiking boots, camels — Halverson's
altitude, and Woodmansee's, measured at **0.1:1 and 0.2:1** abstract-to-concrete.
McLaughlin's habit of renaming institutions as mechanisms ("a covenant
structure," "a spiritual domain," "an order") measures **7.7:1** and is the one
thing in his practice not to take.

A learned word — Latinate or Greek — is legal in exactly two positions, and both
carry the same two conditions.

> **Legal as (a) the name of an ancient thing, or (b) the single term the essay
> is arguing about (1.6). In both cases it is glossed on arrival, and a plain
> Anglo-Saxon verb governs it (tic 14).**

"They would sign the ketubah. It was like the wedding contract." Naming a thing
is not the same as thinking in abstractions, and an abstract subject under a
plain verb reads as thinking rather than fog.

*The check:* count the abstract nouns and the concrete nouns in the draft. If
abstractions lead, the essay is explaining a system when it should be showing a
thing happening to somebody. That is a rewrite, not an edit.

**1.2 — Budget zero intensifiers.**
Halverson's corpus has *amazing* 21 times and *incredible* 20; Woodmansee's has
*really* 81. These are the most visible features of the voice and the cheapest
to copy, and they are not where the warmth lives. Warmth is a structural
expense, paid in Pass 3.

**1.3 — Transitions are never logical. But they are not deictic either — that
half was spoken.** *(Revised in 0.3.0.)*
The negative half is confirmed by a fourth corpus and should be held hard.
Across 31,373 words of Day's own written prose — his essays with block
quotations from scholars and the KJV stripped out, so these are his sentences
and not theirs — *consequently* is at literal zero, and *moreover* (1),
*nevertheless* (2), and *furthermore* (3) together account for six words in
thirty-one thousand. Woodmansee's 26,800 spoken words contain none of the four.
A rule that survived the move from a microphone to a keyboard was never a
spoken artifact.

*Do not round six to zero.* An earlier draft of this section claimed literal
zero for all four, and it was wrong. The practical instruction is unchanged —
at this rate you get one *furthermore* every ten thousand words, so write as
though the budget were zero — but a rule in this file has to survive being
counted, and that one did not.

The positive half was. *Turn with me*, *Keep reading*, and McLaughlin's ~49
`let's` clauses all presuppose a live audience with books open, and **Day writes
none of them.** His written replacements, in frequency order:

- **"In other words,"** — 6 instances, and his single most characteristic
  connective. It always introduces the plain-English restatement of a technical
  claim: "In other words, we naturally go where it is easiest."
- **The interrogative paragraph opener** — see tic 13, which 0.2.0 got wrong.
- **"at least…"** as a trailing hedge (14 instances).
- **"To me…"** (6 instances).
- **The apology-transition**: "Without getting too into some of the intricacies
  of this text, suffice it to say that…"

*Three leaks to budget rather than deny.* Over the full 31,373 words, `thus`
(18, 0.57 per 1,000), `however` (10, 0.32), and `therefore` (10, 0.32) all
cross into writing. Many are sentence-initial and genuinely inferential —
"Thus, Jacob's transformative encounter becomes a temple…" — so do not pretend
they are absent. *Therefore* is the one to watch: it reads as the most
machine-written of the three, and it is as common in Day's prose as *however*,
which means the instinct to ban it outright is taste rather than evidence. See
checklist 5 for the budget. Full replacement table in `teaching-patterns.md`.

**1.4 — Definitions are one short present-tense sentence, verb *is* or
*means*.**
Never "X is defined as." McLaughlin: "an order is a pattern." "sin is
resistance to the spirit or the light of God in any domain." "an altar is how
you traverse a veil." Halverson uses *means* 25 times. Woodmansee gets it in
eight words: "veiling was considered to be a mark of sanctity."

**1.5 — Keep the deflation. Drop the word *just*.** *(Revised in 0.3.0.)*
"righteousness just means that you are rightly aligned to a domain of God."
(McLaughlin.) The payoff shape is right — the definition is smaller than the
reader was bracing for — but the specific word is spoken. **`just` falls from
6.2 to 0.9 per 1,000 words** between Day's speech and his writing, a sixfold
drop. Written Day carries the identical deflation with "suffice it to say
that…", "simply stating that…", and the bare copula. Prescribe the shape, not
the word.

**1.6 — Delete every technical term and see if the claim survives — with one
carve-out the page earns.** *(Revised in 0.3.0.)*
If it survives unchanged, the term was a credential. McLaughlin uses *exogenous*
exactly once and never returns to *apophatic*. Woodmansee has **zero** instances
of *typology*, *exegesis*, *hermeneutic*, *chiasm*, or *epistem-* across 26,800
words.

**But that zero is partly a fact about a microphone.** On the page Day's
technical load nearly doubles: words of eight characters or more go **7.8% →
13.9%**, and Latinate nominalizations **17.2 → 29.8 per 1,000**. A reader can
re-read a word; a listener cannot. So the carve-out is narrow and countable:

> **At most one technical term per essay — the one the essay is arguing about —
> and it is defined on arrival per 1.4 and `teaching-patterns.md` §2. Every
> other technical term still faces the deletion test.**

What rescues the density is the rule 0.2.0 was missing: **the Latinate nouns sit
in the noun slots while the verbs stay Anglo-Saxon, and sometimes deliberately
low.** "Yahweh saying that he is going to **throw down** on all of the gods of
the Egyptians." / "we will have to do a lot of **mental gymnastics** along the
way." An abstract subject governed by a plain verb reads as thinking; an
abstract subject governed by an abstract verb reads as fog.

The pronunciation apology ("I don't know if I'm going to pronounce this
correctly") does not transfer at all. Its written inverse is to **print the
script** — "the Hebrew verbs 'āḇaq אָבַק ('wrestle') and ḥāḇaq חָבַק
('embrace')" — so the humility that was performed as mispronunciation becomes
accuracy the reader can check.

**1.7 — Concrete nouns and arithmetic, not abstract nouns.**
(This is Abram's tic 7, and the corpus backs it hard.) Halverson does not
assert weight, he looks it up: "I actually looked up the weight of an Olympic
shot put, and it's amazingly about the same, 16 pounds." Woodmansee counts:
300 yards of fabric; a door with "a wooden bar that slides across"; yeast that
is "tiny, right? So it was quite a process." Numbers are *better* on the page
than aloud, because a reader can stop on one.

**1.8 — Etymology is cashed out in the very next sentence.**
None of the three lets a root sit as trivia. Halverson decomposes and then
spends it immediately: "Beth, beit means house and lechem means bread." → "So
Bethlehem means house of bread. What better place for the the bread of life
himself to be born?" Also: "The Hebrew words for eternity and conceal actually
share the same root... So eternity, in a sense, is something that is
concealed." The tradition's shortest instance is three words: "Endowment means
gift."

**1.9 — Reusable rules beat one-off results.**
Halverson hands over the tool, not the answer: "if you ever see a name that has
an e l in it, that's short for Elohim." A reader can use that on the next name
they meet. "This name contains a divine element" is a result and dies on
arrival.

**1.10 — Sentence economy: the default clause is long, and short sentences are
*reserved*.** *(Rewritten in 0.3.0. The 0.2.0 rule measured talking.)*

0.2.0 read: *"never two long sentences in a row… after any sentence over thirty
words, the next sentence is under twelve."* That rule came from three corpora of
people speaking, and the control breaks it:

| | Day spoken | Day written |
|---|---|---|
| mean words/sentence | 11.8 | **24.6** |
| median | 9 | **21** |
| % under 6 words | 30.3% | **6.6%** |
| % over 25 words | 9.0% | **37.9%** |

Halverson (median 12), McLaughlin (10), and Woodmansee (10) all sit within two
words of Day's *spoken* median of 9. At the written distribution, **over a third
of sentences exceed 25 words and adjacency is arithmetically forced.** His prose
does not break. His two densest arguments run at 2.1% and 2.3% under six words —
the three-word beat nearly vanishes exactly where the reasoning is hardest.

The corrected rule is not "write long." It is a reservation rule:

> **The default clause is ~20 words. Short sentences are reserved — deployed in
> runs of three or four consecutively, at a paragraph's close or in a list of
> concrete instances. Never one isolated short sentence floating in a
> long-sentence paragraph.**

The staccato run at an argument's close, [9, 1, 8, 3, 3 words]: *"Is the story
somewhat messy, with gaps and problems? Yes! It is human – but it is also
divine. So was Jesus. So are you!"* The enumerated-evidence run, [9, 4, 10]:
*"The text is assuming that the Israelites have options. The Canaanites have
Baal. The people of Moab have Chemosh, the Ammonites had Molech."*

And the finding that governs the whole rule: **the mechanics of speech return
exactly once per essay, in the last paragraph.** Sentence length drops back
toward the spoken benchmark at the devotional landing and nowhere else. Read
that as a claim about the *paragraph-level distribution*: short runs are still
legal anywhere the reservation rule above allows them, but only the closing
paragraph runs at the spoken average throughout. The
short sentence is a licence spent at the end, not a rhythm maintained
throughout.

*Targets (below Day's own numbers, because his prose is unproofed):* median
16–18, mean 20–22. No cap on adjacent long sentences. The real failure the old
rule was groping at is **three consecutive long sentences containing no concrete
noun, no number, and no citation** — that is drift, and that is what to check.

**1.11 — Build long sentences by parallel complement, and keep the trailing
hedge.** *(Reversed in 0.3.0. Both halves of the old rule were backwards.)*

0.2.0 said accumulation, never subordination, and said a trailing dependent
clause is "fine aloud and broken in print." The control says accumulation **is**
the spoken mechanism and the trailing clause **is** the written signature.

*On accumulation.* Between-sentence coordination dies on the page while
within-sentence coordination survives: `and` falls only 33.5 → 26.5 per 1,000,
but **`but` 9.1 → 2.9, `so` 12.8 → 2.7, `because` 4.7 → 0.8.** Sentence-initial
coordination opens 31% of Day's spoken sentences. Budget it at one or two per
essay in writing, and treat "And…" or "But…" as a paragraph opener as a spoken
tic, not a voice marker.

*On subordination.* Day's dominant written engine is a stack of **parallel
`that`- or `wh`-complements hanging off one verb** — "declaring that followers of
God need to 'get up into the high mountain'… that the followers of Yahweh will
be fed like a lamb… and that these individuals will 'wait upon the Lord'" (87
words). Notice that relative subordination barely moves (`which` 2.1 → 2.5,
`although` 0.0 → 0.2); it is the parallel complement, not the periodic sentence,
that does the lengthening. The other three engines: swallowing the citation into
the sentence rather than block-quoting it, appositive stacking of proper nouns
and dates, and a short main clause with a long trailing hedge.

*On the trailing hedge.* Keep it — it is the sentence that most sounds like this
tradition in print: "We don't have the whole picture, rather, we have an edited
account of multiple times when the Lord worked with his prophets to guide the
people… according to their language and culture (D&C 1.24)."

McLaughlin's scope ladder and Halverson's terminal triple still work; they are
list structures, not coordination between sentences.

**1.12 — The parenthesis is the written voice's characteristic mark. Budget four.**
*(New in 0.3.0.)*
This is the largest single shift between the two modes. Parentheses go from
**0.0 to 11.4 per 1,000 words** — from effectively absent in speech to the most
characteristic punctuation in the prose. They absorb three spoken functions at
once: the aside, the hedge, and the citation. Day carries a 60-word aside inside
one without breaking the sentence.

It is also the mark most likely to run away. Eleven per 1,000 means eleven in a
1,000-word essay, which on an edited page reads as a writer who has not decided
what belongs in the sentence. **Cap at four**, and never nest one inside another
— his nested-parenthesis-inside-a-quotation is unproofed blog speed, not a
model.

For contrast, the marks that stay rare in his writing and should stay rare in
yours: **em-dash 0.6 per 1,000** (the rarest punctuation in his prose),
semicolons 1.6 and mostly inside quoted material, colons 6.7 and almost always
introducing a quotation or a list.

**1.13 — Print the script, and let the reader do the collation.** *(New in
0.3.0 — page-only.)*
A listener is *told* that two words share consonants and has to take it on
trust. A reader **checks**. "Genesis 32's account of Jacob (יַעֲקֹב Yaʿăqōb)
crossing the Jabbok (יַבֹּק Yabbōq) river and wrestling (וַיֵּאָבֵק
wayyēʾābēq) with a divine being." This upgrades 1.8 from an assertion the reader
must accept to a demonstration the reader performs, and it is the strongest
argument for etymology in print. Subject to 1.6's one-term budget and 1.12's
parenthesis cap.

---

# Pass 2 — Structure and scaffold

Run this pass on the shape. Pass 1 can be fixed by editing; Pass 2 failures
require rewriting, so do this pass on the outline before there is a draft.

**2.1 — The shape.** *(One shape, not a composite of three, as of 0.4.0.)*
There is no per-subject variant. Every principle essay runs these six beats in
this order.

1. **State the claim, flat, in the opening paragraph — sentence one unless a
   textual anomaly takes it** *(changed in 0.3.0 — was "open on the familiar
   thing made strange")*. If you estrange, the anomaly is one **in the text**
   and it sits in the same opening paragraph as the claim.
2. Go to the evidence. *(Changed in 0.4.1.)* The grant is **not** an automatic
   second beat — it belongs beside the correction it pays for, wherever that
   falls, and an essay that is not correcting a specific reading does not owe
   one at all. See 2.3.
3. Build the prerequisite by one of 2.4's four routes: a machine, a withheld
   custom, an etymology, or a semantic drift. This is the longest stretch and
   it should feel like it is about something else.
4. Define, in one short sentence, present tense, verb *is* or *means*.
5. Cash it out, then test it on the inverse.
6. Land on worry, a question, or a procedure. Do not dwell. Stop.

Step 3 is the part that is hardest to keep and easiest to lose. It looks like
padding to an editor and like digression to a first-draft writer. It is
neither. It is the entire mechanism by which step 4 lands as a reward rather
than as information.

**2.2 — The opening states the claim. Estrangement is demoted to an option, and
the anomaly must be textual.** *(Substantially rewritten in 0.3.0.)*

0.2.0 said "only Woodmansee's opening works on paper" and built the default
around "isn't this the weirdest wedding you've ever heard of?" That was inferred
from spoken corpora, and the one teacher we can watch actually write does the
opposite.

Day is **thesis-first in roughly 12 of ~31 posts**, with no throat-clearing and
no hook — "All of the anti-Christs in the Book of Mormon have essentially the
same goal." He does not earn his way to a thesis; he posts it and then defends
it. **Not one of his ~31 posts opens on a scene.** The closest thing to
narrative is a rock-climbing story that arrives in the third sentence, inside
someone else's quotation, illustrating a doctrine already stated.

The anomaly opening is real and second-ranked (~5 posts), but it is **always an
anomaly in the text** — a gap, a duplication, a contradiction between two
verses: "We have a partial account in the Gospel of Matthew of what happened on
the Mount of Transfiguration, but we are clearly missing some things that
happened here." Never a life anomaly, never weather, never a person walking into
a room.

*Reconciling this with Abram's standing rule.* v0.1.0 required the essay to open
by saying what the doctrine is, "in a sentence a reader could repeat to someone
else." **The control vindicates that rule more strongly than 0.2.0 allowed.**
0.2.0 sent only the *received* meaning early and held the essay's own thesis
back; on the page the thesis can go early too. What is still banned is opening
on a *thesis about the essay* ("This essay argues that covenants are more
expansive than we assume") rather than on the doctrine itself. What gets
withheld is the **sharpened reading and the evidence for it**, not the topic.

**2.3 — Grade the received reading *where you are actually correcting it*.
Never as an opening reflex.** *(Restricted in 0.4.1 on Abram's ruling.)*
This is the move that keeps all three from reading as contrarian, which matters
enormously for doctrinal prose. The formula is literally *X is true, and
there's more* — never *X is wrong*, and the standard reading gets a **full
clause of respect** before the pivot.

*Abram, 2026-08-19, on a draft that opened with the grant.* The draft read: "A
covenant is a two-way promise… **Most of us learned it in about that many words,
and the definition holds as far as it goes.**" His note: *"Who cares? just
assert what it is and teach it bro."*

**The grant is a debt paid at the moment of the pivot, not a toll paid at the
door.** If the essay is about to sharpen a specific reading, grant that reading
right there, in the same paragraph as the correction. If sentence two is
grading a definition the essay has not yet challenged, it is throat-clearing
wearing good manners, and it spends the opening's momentum on what other people
think. The tradition's own instances all sit mid-argument — McLaughlin's "Which
isn't a wrong answer" arrives *after* the two-way-promise answer has been put on
the table and *as* he pivots off it.

An essay may open with a flat definition and go straight to the evidence. Most
of Day's do.

- McLaughlin: "Two-way promise, right? Which isn't a wrong answer, but it's not
  a sufficient, it's not a comprehensive answer."
- Woodmansee: "certainly all of that is true, but I think there's a big piece
  that we're missing."
- Halverson concedes the underlying value outright — on inclusivity, "and
  that's a good thing" — before he criticizes the overcorrection.

The concession is not tactical politeness. It is what buys the reading that
follows.

**2.4 — Build the prerequisite by one of four routes. The term picks the route,
not the teacher.** *(Selector clarified in 0.4.0 — these are techniques, and any
of them is available for any essay.)*

- **Prerequisite chain** — for system terms: dominion, then the unseen world,
  then agency, then veils, and only then altar. (Attested in McLaughlin.)
- **Withheld cultural fact** — for ritual and narrative terms: the token at the
  door, the wooden bolt, the recognition of the voice. (Woodmansee.)
- **Etymology decomposed** — for names and loaded words. (Halverson.)
- **Semantic drift anchored to a dated secular usage** *(new in 0.3.0 —
  page-only, for ordinary English words that have moved).* This is the best
  definition in either of Day's modes, and it is page-only because it asks the
  reader to hold two dates at once: "'comfort' embodied the notion of 'with
  strength'… This interpretation persisted into 1787, evident when the American
  Constitution described treason as 'giving aid and comfort to the enemy,'
  signifying not merely providing relief but empowering an adversary." Four
  beats: word → drift named as the problem → older sense → **non-scriptural
  corroborating usage** → payoff. It is the one place in ~31 posts he defines an
  ordinary English word rather than a foreign one, and the dated secular
  citation is what keeps it from sounding like folk etymology.

**2.5 — One analogy per essay, and it carries the argument.**
All three flag the figure as an instrument and then exhaust it. Halverson's
Sinai hike maps darkness, dawn, summit, camels, and carved stairs, each cashed
for a doctrinal claim before he opens the text — and it arrives as an
instruction, "I hope you brought your hiking boots today," before it is ever a
metaphor. McLaughlin returns to his by name: "Let's go back to the airplane."

**The test:** delete the analogy and see whether the claim survives. If it
survives, the analogy was decorative — cut it. The imitator's failure is to
write the doctrine and then add *it's like a...*; all three do the reverse.
Build the mechanism, let the doctrine fall out.

**2.6 — Test the definition on the inverse or the edge, in the same breath.**
McLaughlin runs the altar definition against Cain immediately: "Satan or the
adversary or the dark domains do not have altars that are independent of
themselves." Woodmansee corrects her own inversion before it overshoots: "But
the interesting thing is, it's not a wall right it's a veil and so a veil is
meant to be traversed."

**2.7 — Define in pairs when the term has a twin.**
Endure and overcome. Justification and sanctification. Obedience and sacrifice.
Veil and wall. This tradition resolves difficulty by locating both sides inside
the same verse rather than defeating one — which is what Halverson means by
"proving contraries," and it is why the tradition's definitions rarely read as
polemic. (Budget note: this is *paired contrast*, not the not-X-but-Y seesaw of
tic 2. The seesaw negates; the pair holds both.)

**2.8 — Solve the block-quote problem with the inline gloss.**
This is the single highest-value transferable mechanic in the three corpora.
Halverson does not block-quote and then explain; he interrupts *inside* the
quotation: "whose height was six cubits in a span. **That's nine and a half
feet tall.**"

The long verbatim read is spoken-only. Woodmansee reads the Isaiah 22 Eliakim
block for roughly 200 words; aloud, length *is* the argument, because the
audience feels the density before it gets sorted. On a page, readers skip block
quotes. Cut to the load-bearing clause — the commentary usually isolates it for
you already ("So look at verse 21").

*Confirmed in 0.3.0 by counter-example.* Day is the writer who did **not** solve
this, and the cost is visible: he stacks five unheaded block quotes in a row,
and in several posts the quoted material outruns his own five or ten to one. One
post runs ~1,800 words of someone else's argument behind 90 words of his own.
**This is the capability the page grants and Lintel declines.**

But take his framing formula, which is remarkably fixed across the corpus and is
the one thing he does right at the block quote — **source named with title →
what it argues in one sentence → a first-person statement of the writer's
relation to it**: "The following excerpt comes from 'Who Shall Ascend to the
Hill of the Lord?' by LeGrand Baker. I am indebted to him as well as David Smith
for my increased understanding of the text of Ephesians 1…"

And take **Pattern 6**, his method for a technical quotation: quote the
definition, then restate it in one plain sentence of your own. Gary Anderson,
quoted: "the former usage reflects a processual usage of the verb, while the
latter usage would be resultative." Day, immediately after: "It means 'to
empower, and the empowerment causes one to be able to transcend suffering and
sorrow.'"

**2.9 — Questions defer by a paragraph, not by a sentence.**
An imitator asks three questions and answers them in the next sentence, which
converts a structural device into throat-clearing. Woodmansee's discipline is
the model: "Now this sets up a question for us... So was this a returning of to
how Israel was supposed to practice their religion? Or was this a change
perhaps for political purposes? **I think we get a hint of our answer in the
next verses.**"

**2.10 — Land on worry, a question turned on the reader, or a procedure. Then
stop.**
None of the three lands an application as a command.

- Worry — Halverson: "I do worry, my friends, if there are times where we find
  ourselves wandering."
- Question turned on the reader — Woodmansee: "Am I on that side of the door?"
- Procedure with the literal words supplied — McLaughlin: "what is my actual
  sin? And two, teach me how to repent."

Nobody dwells. Halverson cuts straight to the next verse number: "Please keep
that in mind. Now to help us understand how we need to be ready, Joshua one is
an incredible place to begin. Verse one..." Nobody *exhorts*. Neither *we must*
nor *let us* appears anywhere in the three spoken corpora — though both appear
in the written control (`we must` 7 times), always as an analytical procedure
and never as a call to righteous action. See tic 16: the ban is on the
exhortation, not on the words.

**2.11 — Keep the sequence, drop the amplitude.**
Halverson runs five-hour episodes and defends the cost out loud: "they'll get
the same parts every four years. And they'll skip the same parts every four
years." McLaughlin knows his own diffuseness — "We can unwrap this forever, so
I gotta be careful not to go down too many rattles." His covenant explanation
runs roughly 1,400 words of physics, bears, log cabins, and Locke before it
names anything.

An 1,100-word essay cannot afford that, and worse: **a reader can see the page
and will skim to the bolded sentence, which collapses the withholding
entirely.** So shorten his runway to about a third and use no bold. Everything
in these corpora that reads as generosity of time is a budget the essay does
not have. One digression per essay, and it has to be load-bearing.

**2.12 — Form constraints (unchanged from 0.1.0; the replacement for headings is
new in 0.3.0).**
No headings, no bullets, no numbered beats. Continuous prose in paragraphs that
each carry one movement of the argument. Six to ten paragraphs, 700–1,100
words. Show the doctrine working on particular people in particular
situations, not in a survey. The examples ARE the argument; a claim that cannot
be shown happening to someone probably is not ready to print. Close on the
reader's situation, not on a summary of what was just said.

*Supply what the ban removes.* Day's headings do the work that *however* and
*moreover* do in academic prose — **they are his connectives.** Remove them and
the essay does not lose content; it loses its seams. 0.2.0 banned them and
offered nothing in their place, which is why drafts under it drift. The
replacement already exists in the tradition, and each heading type converts:

- Every `**Why?**`-style heading is one rewrite away from a **paragraph-opening
  rhetorical question** (see tic 13, revised).
- Every address heading (`Psalm 82`, `Job 1`) is one rewrite away from a
  **declarative paragraph opener naming the text**: "For example, we can examine
  Psalm 95." / "On the other side of this rivalry are the Aaronids." Roughly a
  quarter of Day's body paragraphs already open this way, and that is where
  "let's turn to" goes on a page.

Also refuse the **enumerated catalogue** — the seven feasts, an A–E marking
scheme. The control confirms those posts are reference documents wearing an
essay's clothes. And refuse **apparatus**: footnotes, "Further Reading," charts,
attached PDFs. The failure mode is explicit in the corpus, where one post is
framing prose only because the substance lives in an attached PDF. On a podcast,
silence is dead air and he would have had to say something. **On a page, an
attachment counts as delivery — so the page lets a writer publish an argument he
never actually made in words.** That is the specific hazard of writing in this
tradition.

---

# Pass 3 — Human texture

This is where warmth actually lives. It is structural and it costs something;
none of it can be bought with adjectives.

**3.1 — The *we* must be self-implicating.**
None of them uses the safe pastoral *we* that means *you*. Halverson: "We
guardians of the storehouse, we who live here in Bethlehem... We have to do
better." McLaughlin takes the indictment first and hardest: "I'm saying this
because I do this every day and I'm becoming more and more aware of it. of how
much of the devil's kingdom I build every day. I build it every day."
Woodmansee: "I never stopped to consider... Why am I doing this?"

If a *we* in the draft could be swapped for *you* without changing the meaning,
it is the wrong *we*.

**3.2 — Mark the boundary of knowledge out loud.**
This is a genre requirement, not a personality trait. In doctrinal prose the
unhedged claims only land hard if the hedged ones were hedged honestly.

**The model form** — the boundary sits on the *text*, and no persona is spent:

- Halverson: "Now verse 12 says that Jesse had eight sons. In the book of first
  Chronicles, it says he had seven, so there's some discrepancy there. We don't
  totally know."
- Woodmansee: "whether that's good or bad is the scholars debate."

*Recorded but not to be copied* (0.4.0): McLaughlin's "When I suggest this, I
could be just dead wrong, and I'm very open to that" marks the boundary on the
**speaker** rather than on the text. That is frame-hedging, which 3.3 settled
against and 3.8 forbids outright — it spends an author persona the essays do not
have.

**3.3 — Definitions flat, inferences hedged. One posture, and it is settled.**
*(Was a three-way choice; settled in 0.4.0.)*
The corpus offers three theories of authority, and mixing them makes an essay
illegible — an essay that hedges its frame *and* grades every claim *and*
asserts its definitions flat reads as nervous rather than careful.

The posture Lintel uses is Halverson's: **state meanings flat, hedge only the
inferences drawn from them.** "Maybe he wanted both hands free... I don't know"
— hedged, because it is a guess about a motive. The definition it hangs off is
not hedged at all.

The reason this one wins is 3.8: **Lintel's essays have no author persona.** The
other two postures need one. "I hate saying this is the definition of this"
(McLaughlin, hedging the frame) and "I'm putting forward a theory that some Bible
scholars would probably discount" (Woodmansee, grading each claim) both spend a
personal authority the essays do not have and cannot manufacture. Halverson's is
the only one of the three an unsigned institutional voice can hold honestly: a
definition is either right or it is not, and where the essay is reasoning past
the text it says so.

*The budget is one hedge per four sentences.* Woodmansee's stack — "So it's
possible that... I find it to be very likely that... I think... I believe..." —
is three in four, which is evasion on a page.

**3.4 — Voice the objection instead of asking the reader a question. Best form:
quote it as a student's question.** *(Improved in 0.3.0.)*
Halverson: "Now that seems exclusivistic though, doesn't it?" This is the prose
replacement for McLaughlin's live elicitation, and it should be used wherever a
live teacher would have turned to the host. Note what Halverson does next: he
lets *exclusivistic, paternalistic, postcolonial* land, and then knocks them
over with two words. "Come on."

Day's written version is better than Halverson's spoken one and is the one to
copy: **attribute the objection to a real asker and quote it verbatim in
quotation marks.** "Students often ask, 'Well, which is it? Are we worth less
than the dust of the earth, or do we have great inherent worth as children and
heirs of God?' Can both of these statements be true simultaneously?" The
attribution does the work the tag question does aloud — it makes the objection
someone's rather than the writer's rhetorical property — without the
tag-question tic, which is spoken.

**3.5 — Free indirect speech, but punctuate it. — UNEVIDENCED ON THE PAGE.**
*(Flagged in 0.3.0.)*
Halverson drops into unmarked first person for biblical characters: "Oh, great.
It's probably him. He always shows up when you don't want him to." It works on
the page, but it needs punctuation and framing the transcript does not supply.
McLaughlin's ventriloquized adversary voice needs the same repair; without it
his Satan-voice and his own voice run together and become unreadable.

**There is no instance of unmarked first person for a scriptural character
anywhere in Day's written corpus.** This rule may well be right, but unlike its
neighbours it is not measured — it is an inference from spoken practice. Treat
it as a permission, not an instruction, and do not let a draft lean on it. Day's
written substitute for a character's interior state is plain third-person
attribution plus the textual evidence for it.

**3.6 — Diagnose failure as order of operations, never as effort.**
McLaughlin's answer to failure is always "your order of operations is wrong,"
never "you aren't trying hard enough" — the C-130 with the throttle pushed on a
cold tarmac. Take this as a standing editorial policy for every application
paragraph.

**3.7 — Coin at most one portable label, and only if it is reusable.**
"Proving contraries." "The Wednesday morning question." "Temple glasses." Print
is where these actually stick, because a reader can flip back to one.

**3.8 — Confession beats biography you do not have.**
Woodmansee's "I will admit that at one point in my life, I was kind of right
here I had fallen praise to some of the scoffing of the critics" works because
it is true and because she dates her turns precisely. **Lintel's essays have no
author persona and no such history.** Do not manufacture one. The substitute is
3.2, the boundary-of-knowledge marker: "We don't totally know" requires no
biography and costs nothing in credibility.

**3.9 — One aphoristic inversion per essay, maximum, and only after the
argument.**
Halverson's antimetabole is the most tempting thing in these corpora — "I'm
trying to make you different so you can make a difference," "not to earn
anything, but to relearn," "not called to replace them. You're called to
succeed them." It works because it arrives once, at the end, built on a stem
the argument already established. **If you can write the inversion before you
write the argument, the inversion is fake**, and it will read as a fortune
cookie.

**3.10 — Compress scholarship into the sentence, not into an apparatus.**
Woodmansee on Margaret Barker: piecing together "what Joseph Smith had
delivered on a platter." One sentence, no footnote, and the whole argument is
in it.

---

# The tic list

Rules 1–11 are Abram's, from rejected drafts, preserved verbatim from v0.1.0.
Rules 12–18 are corpus-derived (0.2.0); 19–21 are corpus-derived (0.3.0).
**Rule 22 is Abram's, from a draft rejected 2026-08-19**, and carries the same
authority as 1–11. Each one is cheap to commit and instantly recognizable.

**On the 0.3.0 notes under rules 1–11.** The written control contradicts six of
Abram's eleven. **His rules are unchanged and remain in force** — they encode
what he rejects in a draft, which no corpus can overrule. The notes exist so
that a writer who hits friction knows the friction is real and where it comes
from, and so Abram can rule on it deliberately rather than rediscovering it in
another rejected draft. Where a note appears, follow the rule and flag the
tension in the handoff.

1. **Bold section leads.** `**Abraham.**` `**When it breaks.**` A labelled
   block is a listicle wearing an essay's clothes. Let a paragraph turn on
   its own first sentence, which should start in the middle of the thing:
   "Abraham is old and childless when the Lord covenants with him."
   (Not "Consider Abraham" — see rule 10.)

2. **The not-X-but-Y seesaw.** "not a special arrangement but the shape of
   the relationship." "not relief but increase." "not thereby ended." One per
   essay is rhetoric; four is a tell. Say the positive thing and move.

3. **Opening on a negation.** Start with what the doctrine *is*. A reader who
   needs the misconception cleared first will get it cleared by the
   explanation.

4. **The epigram landing.** Ending every paragraph on a tidy summarizing
   aphorism ("The seriousness is what makes the expansion possible.") reads
   as a machine tying a bow on each beat. Land hard occasionally; earn it.

   > *0.3.0 note — confirmed at paragraph level, contradicted at essay level.*
   > Day does not do this at every paragraph close, so read strictly (the rule
   > says "every paragraph") it holds. But **every essay in his corpus lands on
   > a compressed epigram**: "It is human – but it is also divine. So was Jesus.
   > So are you!" Read as a ban on the closing epigram, the rule is
   > contradicted. Abram's call which reading he meant.

5. **Citation after every quote, in parentheses.** `(Genesis 17:5)` four
   times a paragraph breaks the rhythm the prose is trying to build. Name the
   source in the sentence when it matters — "when the Lord renames him in
   Genesis 17" — and let the reference ride quietly otherwise.

   > *0.3.0 note — directly contradicted, and by a written feature rather than
   > a spoken one.* Day's own-voice corpus carries **at least 65 in-line
   > parenthetical scripture references in 14.2k words** (a floor — strict
   > pattern match only), always immediately after the quoted clause, never
   > footnoted. Total parenthesis density rises from 0.0 to **11.4 per 1,000**
   > from speech to writing. The tic assumes parentheses break the rhythm; in
   > this tradition's written mode they *are* the rhythm. Incidental datum if
   > the rule is ever relaxed: he uses period style over colon style **40 to
   > 25** (`1 Nephi 1.2`), which is diagnostic, since most LDS writing uses
   > colons. Abram's call.

6. **Monotone sentence length.** Fifteen to twenty-five words, declarative,
   subject-verb, over and over. Vary it or the prose hums.

   > *0.3.0 note — the variance complaint is confirmed; the named band is not
   > the problem.* Day's written median is 21 and his mean 24.6, so
   > fifteen-to-twenty-five is exactly where this tradition's prose lives. His
   > range runs 1 to 146 words, which is the actual lesson. **Unvaried** is the
   > defect, not the band. See 1.10 for the reservation rule that produces the
   > variance.

7. **Abstract nouns doing the work.** "enlargement," "capacity," "provision,"
   "mechanism." Prefer the concrete thing that abstraction stands for.
   "Pharaoh's brickmakers are offered the priesthood" beats "the covenant
   expands their standing."

   > *0.3.0 note — contradicted in degree.* Latinate nominalization rises
   > **17.2 → 29.8 per 1,000** from Day's speech to his writing; abstraction
   > moves *toward* the page, not away from it. What rescues his prose is that
   > the **verbs** stay concrete and low — *throw down*, *jab*, *line their own
   > nests*, *sheathing it*. If this tic is to survive the control it should
   > become a verb rule rather than a noun rule: an abstract subject is fine
   > when a plain verb governs it. Abram's call.

8. **Em-dash appositives as a rhythm crutch.** Two per essay, maximum.

   > *0.3.0 note — confirmed emphatically, and could tighten.* The em-dash is
   > **the rarest punctuation in Day's written prose at 0.6 per 1,000**. Two per
   > 1,000-word essay is 2.0 per 1,000 — still over three times his rate.

9. **Throat-clearing.** "It is worth noting," "Importantly," "In essence."
   Cut every one.

10. **Directing the reader's attention** (Abram, 2026-08-19, the one he
    caught fastest). "Watch what it does." "Notice the direction." "It is
    striking how little..." "Consider Abraham." Every one of these is the
    writer tapping the reader on the shoulder because the sentence that
    follows is not trusted to land on its own. Just explain it. If the
    observation is good the reader will notice without being told to, and
    if it is not, the instruction will not save it.

    > *0.3.0 note — directly contradicted, and it is a written **increase**.*
    > Written Day does exactly the banned thing: "You will note that in this
    > passage the promise received by Jesus is extended to all those who
    > 'overcome'"; "This chapter is one I would recommend that readers take
    > slowly in order to digest what is really going on in the text." The
    > pedagogy read is that these are **pacing instructions supplied because he
    > cannot slow down for the reader with his voice** — so they are page-only,
    > not talk-residue. That does not make them good, and the tic may still be
    > right for Lintel. But the premise that they are a spoken artifact is
    > false, and if the rule is kept it should be kept on taste rather than on
    > the corpus. Abram's call.

11. **Editorializing about the reader.** "you did not draft the terms and
    could not have." The reader did not ask to be told what they are
    incapable of. State the fact — the terms are God's — and stop.

    > *0.3.0 note — contradicted in one specific form.* Day names the reader's
    > emotional state before answering it: "It may seem troubling when first
    > presented with this material… But it shouldn't be too troubling."
    > Note the difference from the rejected draft: the banned version tells the
    > reader what they **lack**; Day's tells the reader what they will **feel**
    > and then discharges it in the same sentence. If the tic is meant to ban
    > the first and permit the second, it should say so. Abram's call.

12. **Warmth ported as adjectives — and its relocation into punctuation.**
    *Amazing*, *incredible*, *really*, *beautiful*, *profound*. These are the
    most visible features of the spoken voice and the cheapest to copy —
    Halverson says *amazing* 21 times, Woodmansee says *really* 81 — and none
    of the warmth is in them. An imitator takes the adjectives, drops the
    structure, and produces enthusiasm without cause. Budget: zero. See Pass 3.

    *Confirmed in 0.3.0* — Day's written corpus has *amazing* 0 and
    *incredible* 1. Two refinements. His 12 instances of *really* are all
    adverbial on a **verb** ("really hit me," "really don't know"), never
    intensifying an adjective; the ban is on the adjective intensifier, so
    those are legal. **And plug the leak:** his written exclamation points run
    at **2.0 per 1,000** — "Of course Israel had options!" — doing exactly the
    work a voice would otherwise do. Ban the exclamation point alongside the
    adjective, or the intensifier budget simply relocates to punctuation.

13. **The comprehension hand-back — but the interrogative pivot is its
    legitimate written cousin.** *(Second half reversed in 0.3.0.)*
    `Does that make sense?` (McLaughlin, near every major beat), `right?`
    (Woodmansee, 49 times), `Okay?` and `K?` (Halverson). These invite a
    listener to say no; a reader cannot. Delete them — **Day's written corpus
    has zero.**

    0.2.0 went on to ban converting them into rhetorical questions. **That was
    wrong, and it conflated two different devices.** Written Day has **42
    question marks and zero hand-backs**, and the question-as-paragraph-opener
    is his primary structural hinge: "So what is the Bible?" / "How does this
    passage work?" / "To get to the original question: Did the Levites
    sacrifice to idols?" **A question is his paragraph seam, and it carries the
    load that *moreover* carries in academic prose** — which is exactly what
    2.12 needs now that headings are banned.

    The distinction that matters: a hand-back invites the reader to answer and
    stalls if they cannot; an interrogative pivot invites nobody to do anything
    and simply turns the argument. Keep the second, delete the first, and apply
    2.9's paragraph-deferral discipline only to genuine open questions.

14. **Technical vocabulary as a credential — with the one-term carve-out.**
    *Typology*, *hermeneutic*, *exegesis*, *chiasm*, *epistemic*, *apophatic*.
    Woodmansee's 26,800 words contain zero of the first five. Delete the term;
    if the paragraph's claim survives unchanged, the term was a credential and
    stays deleted.

    *Qualified in 0.3.0.* That zero is partly a fact about a microphone — Day's
    written technical load nearly doubles (see 1.6). The essay's **own** term
    may be technical if it is defined on arrival. Everything else still faces
    deletion, and the governing test is now the verb: a Latinate noun phrase
    is acceptable when a plain Anglo-Saxon verb governs it.

15. **The manufactured inversion.** See Pass 3.9. If it was written before
    the argument, it is fake. One per essay, maximum.

16. **Application as exhortation.** *We must.* *Let us.* *May we.* Land on
    worry, a question turned on the reader, or a procedure with the literal
    words supplied.

    *Corrected in 0.3.0 — the old justification was false.* 0.2.0 claimed
    "neither of the first two appears anywhere in these corpora." That is true
    of the spoken corpora and **false of the written control**: `we must`
    appears **7 times in Day's writing against 0 in his speech**, and `let us`
    once. So the phrase is not the tell — writing it is what this tradition
    does on a page.

    **The rule survives on function, not wording.** Every one of Day's
    instances is an *analytical procedure*, marshalling the reader through a
    reading step: "we must examine who the Levites were in the first place" /
    "We must examine our assumptions" / "we must remember that the authors of
    these accounts were writing from their perspective." Not one is an
    exhortation to righteous action. **Ban the exhortation, not the words**:
    "we must be more faithful" is out; "we must first ask who wrote this" is
    the tradition working normally. The checklist sweep changes accordingly.

17. **Estrangement with nothing behind it.** "isn't this the weirdest wedding
    you've ever heard of?" is a **debt**. If you make a text strange and then
    discharge the tension with a fact the reader already had, you have spent
    attention and paid nothing. Every anomaly needs a genuinely withheld
    concrete fact — a custom, a root, an object, a political pressure — or it
    should not be raised.

18. **Restatement for emphasis.** "So all laws have a law of sacrifice that
    are inextricably connected to it. So all laws have sacrifices." Aloud
    that is emphasis; in print it is redundancy. Substitute: give the second
    version its own paragraph and delete the first. *(Confirmed in 0.3.0:
    absent from the written corpus, common in the spoken.)*

19. **Sentence-initial coordination as a voice marker.** *(New in 0.3.0.)*
    Opening sentences with *And*, *But*, *So*, *Because*, or *Now* is the
    single most reliable spoken tell in the control: **31% of Day's spoken
    sentences** begin this way, `And` alone accounting for 16.3%. On the page
    it collapses — sentence-initial `but` **9.1 → 2.9 per 1,000**, `so` **12.8
    → 2.7**, `because` **4.7 → 0.8** — while `and` *within* the sentence barely
    moves (33.5 → 26.5). The chain moves inside the period. A draft that opens
    three paragraphs with "But" has transcribed a podcast. Budget: one or two
    per essay, total.

20. **The orphaned short sentence.** *(New in 0.3.0; threshold stated in
    0.4.0.)* **A "short" sentence is one under nine words** — that is the single
    threshold, and checklist 4 uses it too. One dropped alone into a paragraph
    of twenty-word sentences reads as a writer performing punch. In the control the short sentence never appears
    alone — it comes in **runs of three or four**, at a paragraph's close or in
    a list of concrete instances: "So was Jesus. So are you!" If there is one
    short sentence in the paragraph, either give it two neighbours or fold it
    back into the sentence before it. See 1.10.

21. **Apparatus, and the attachment that counts as delivery.** *(New in
    0.3.0.)* Footnotes, "Further Reading," downloadable charts, attached PDFs,
    enumerated catalogues. The failure mode is explicit in the control: one
    post is framing prose only, because the substance lives in an attached PDF.
    Aloud, silence is dead air and the argument has to be *made*. **On a page,
    an attachment counts as delivery — so the page lets a writer publish an
    argument he never actually made in words.** If it is not in the prose, it
    did not ship. See 2.12.

22. **The preamble — grading the reader's understanding, and announcing what
    the essay will cover.** *(Abram, 2026-08-19. Same authority as 1–11.)*
    Two shapes, both rejected on the same draft, both in its first paragraph.

    *Grading what the reader already knows:* "Most of us learned it in about
    that many words, and the definition holds as far as it goes."

    *Announcing the essay's own contents:* "What it leaves out is the
    arithmetic of the thing — who carries the risk when the promise is made,
    and what the promise does to the person who accepts it."

    His note in full: **"Who cares? just assert what it is and teach it bro."**

    The second shape was already banned by 2.2 as "a thesis about the essay
    rather than the doctrine itself," and it still shipped, which is why it is
    a tic now and not only a rule. A sentence that describes what is coming is
    not teaching; it is a table of contents in prose, and the reader who wanted
    it can scroll. **Assert the doctrine, then go straight to the evidence for
    it.** If a paragraph can be deleted and the reader loses no fact, no
    passage and no image, it was preamble.

    Note what this does *not* ban: the flat opening definition itself is
    required (2.2, checklist 19), and the grant is still correct beside a real
    correction (2.3). What is banned is spending the opening on the reader's
    prior state or on the essay's own table of contents.

---

# Scripture discipline

- Every quoted passage must be verified against `lumen.verses` before it
  ships. Query the database; do not quote from memory. A misquoted verse in
  a study app is the one error that costs trust outright.
- Prefer narrative passages that SHOW the doctrine operating over proof-texts
  that assert it.
- Three to eight passages per essay. More than that is a concordance.
- Gloss inside the quotation rather than after it (Pass 2.8), and cut every
  quotation to its load-bearing clause.

## The collection's own reading

When an essay belongs to a collection that teaches the principle, close with
what that collection sees in it — grounded in a real transcript quote, cited
with its timestamp. This is what makes the essay Stick of Joseph's rather
than generic, and it is the pitch. Never invent the reading; if the corpus
has nothing distinctive to say, leave the section out.

Spelling, because the source data is wrong: the host is **Todd McLaughlin**.
All nine of the channel's own video titles misspell it "McLauchlin," and the
collection slug (`soj-todd-mclauchlin`) follows the channel. Display text and
essay prose use McLaughlin. Also **Andrea Woodmansee**, **Jared Halverson**.

## Working with Abram

He supplies the angle — which facet of the doctrine the essay should turn on.
Ask for it rather than choosing one. **If no angle is supplied and there is
nobody to ask** — an unattended drafting run — choose one, state it in the first
line of the handoff, and treat it as the first thing to be reviewed. A stalled
run helps nobody, and a silently guessed angle is worse than a declared one.
For Covenants he wanted the expansive
nature: agency, blessings, capacity to receive light and to share it; two-way
promises weighted in our favor; the Atonement as the fail-safe when we break
them; and that none of that makes them casual.

Every essay lands in the review queue at /admin/enrichment, where he accepts,
rejects, or notes it. Read his notes before writing the next batch — they are
the calibration signal this skill exists to accumulate.

---

# The checklist

Run every item before returning a draft. Each one is countable or answerable
yes/no; do not return a draft with an unanswered item.

1. **Withholding — of the evidence, not the claim** *(revised in 0.3.0)*. Does
   the **sharpened** definition arrive after the prerequisite? The essay's
   topic and its thesis may both sit in sentence one; what must not arrive
   early is the sharpened reading and the evidence for it. If a reader could
   skip to paragraph two and get the whole *argument*, the essay has no shape.
2. **The definition sentence.** Is it one sentence, present tense, verb *is*
   or *means*, and shorter and plainer than the essay's own opening sentence?
3. **The grant** *(restricted in 0.4.1).* Only if the essay corrects a specific
   received reading: does that reading get a full clause of respect, **in the
   paragraph where the correction happens**? Search the draft for the word
   *wrong* applied to it. A grant in sentence two, before the essay has
   challenged anything, is a FAIL — see 2.3 and tic 22.
4. **Sentence economy** *(rewritten in 0.3.0 — the old numbers measured
   speech).* Median 16–18 words, mean 20–22. **No cap on adjacent long
   sentences.** Instead check the two real failures: (a) three consecutive long
   sentences containing no concrete noun, no number, and no citation — that is
   drift; (b) any isolated short sentence not part of a run of three (tic 20).
   At least one run of three or more consecutive sentences under nine words,
   placed at a paragraph's close. The final paragraph may run at the spoken
   distribution — mean under 14, median under 10 — **once**.
5. **Connective sweep** *(budget corrected against a recount of 31,373 words
   of Day's own written prose, quotations stripped).* Zero instances of
   *consequently*, *in conclusion*, *in essence*, *importantly*, *it is worth
   noting*. Treat *moreover* (0.03 per 1,000), *nevertheless* (0.06), and
   *furthermore* (0.10) as zero — that is one word every ten thousand, which
   is not a budget you can spend inside a 1,100-word essay.

   **At most one** of *however* (0.32), *therefore* (0.32), or *thus* (0.57)
   per essay — one of the three, not one of each. *Therefore* belongs in this
   budgeted group and not in the banned one: it is exactly as frequent in
   written prose as *however*, and an earlier draft of this checklist banned
   it outright on a miscount.
6. **Intensifier sweep.** Zero instances of *amazing*, *incredible*,
   *really*, *profound*, *beautiful*, *powerful* as adjective intensifiers
   (tic 12). **Zero exclamation points** — Day's run at 2.0 per 1,000 and are
   where the intensifier budget relocates if you only ban the adjectives.
7. **Attention-direction sweep** (tic 10). Zero instances of *notice*,
   *watch*, *consider*, *observe*, *it is striking*, *note that* — **in the
   essay's own sentences, not inside quotations.** Scripture is full of looking
   and beholding; the sweep is about the writer directing the reader, not about
   what a verse says. The same scoping applies to sweeps 5, 6 and 8.
8. **Exhortation sweep** (tic 16, *revised in 0.3.0*). Zero instances of *may
   we*. For *we must*, *let us*, and *we should*, check the **function** rather
   than the phrase: an analytical procedure ("we must first ask who wrote
   this") is legal and attested 7 times in the written control; an exhortation
   to righteous action ("we must be more faithful") is out.
9. **Question sweep** (tic 13, *revised in 0.3.0*). Zero comprehension
   hand-backs (*does that make sense*, *right?*, *okay?*). Paragraph-opening
   interrogative pivots are **encouraged** and are the primary replacement for
   banned headings. Only genuine open questions must be deferred by at least a
   paragraph (2.9).
10. **The analogy test.** Delete the analogy. Does the claim survive? If yes,
    the analogy was decoration — cut it. Is there more than one? Cut to one.
11. **The technical-term test** (tic 14). Delete each technical term. Any
    paragraph whose claim survives unchanged keeps the deletion.
12. **The inversion test** (tic 15). At most one antimetabole, and it appears
    after the argument that earns it, built on a stem already in the essay.
13. **Register** *(settled in 0.4.0 — no longer a choice).* Count the abstract
    nouns (*domain*, *structure*, *order*, *principle*, *system*, *process*)
    against the concrete ones (*bread*, *stone*, *door*, *water*, *feet*).
    Concrete must lead or tie. A learned word — Latinate or Greek — is legal
    only as the name of an ancient thing or as the essay's single argued term
    (1.6), glossed on arrival and governed by a plain verb (tic 14).
14. **Hedge posture** *(settled in 0.4.0).* Definitions stated flat, inferences
    hedged, held throughout. No hedging of the frame, no per-claim grading —
    both need an author persona the essays do not have (3.3, 3.8). No more than
    one hedge in any four sentences, and **at least one boundary-of-knowledge
    marker somewhere in the essay** (3.2) — zero hedges is its own failure, not
    a clean sheet.
15. **The *we* test.** Every *we* is self-implicating. Swap each for *you*;
    if the meaning is unchanged, rewrite it.
16. **The landing.** Worry, a question turned on the reader, or a procedure.
    Nothing after it. No summary paragraph.
17. **Anomaly debts** (tic 17). Every strangeness raised is discharged by a
    concrete fact the reader did not already have.
18. **Form.** No headings, no bullets, no numbered beats, no bold. Six to ten
    paragraphs, 700–1,100 words. Two em-dashes maximum (tic 8). **Four
    parentheses maximum, none nested** (1.12) — the cap counts asides and
    hedges. It is not a citation budget, because under tic 5 citations are not
    parenthetical in the first place: name the source in the sentence when it
    matters and let the reference ride quietly otherwise. If tic 5 is ever
    relaxed, parenthetical references ride free of this cap and the written
    control's period style (`1 Nephi 1.2`) applies. No footnotes, no "Further
    Reading," no attachments — if it is not in the prose, it did not ship
    (tic 21).
19. **Opening** (2.2, *tightened in 0.4.1 — tic 22*). Does sentence one state
    the doctrine flat? If the essay opens on an anomaly instead, is the anomaly
    **in the text** — a gap, a duplication, a contradiction between two verses
    — rather than a scene, a life anomaly, or weather? Zero essays in the
    written control open on a scene.

    **Then read sentence two.** If it grades what the reader already believes,
    or announces what the essay is going to cover, delete it and check whether
    the reader lost a fact, a passage or an image. If nothing was lost it was
    preamble, and the essay should reach its first piece of evidence by
    sentence two or three.
20. **Spoken-tic sweep** (tics 19–20, *new in 0.3.0*). At most two
    sentence-initial *And/But/So/Because/Now* in the whole essay. Zero
    contractions beyond what a quotation carries — they fall sevenfold from
    speech to writing (51.7 → 7.3 per 1,000).
21. **Scripture verified.** Every quoted passage checked against
    `lumen.verses` this session, not from memory. Three to eight passages.

    *Where to read* **(0.4.0 — this was unrunnable as written).* The local
    Supabase seed carries **~162 verses**, not the canon, so a local query
    silently misses nearly every passage and trains the writer to quote from
    memory — the one error that costs trust outright. **Verification reads
    production, read-only**, the same exception extraction takes. The column is
    `reference` (not `ref`): `select reference, text from lumen.verses where
    reference = 'Mosiah 13:31'`. A passage that does not come back is not
    "missing from the seed" — it is a passage you have not verified, and it does
    not ship.
22. **Collection quote.** If the essay belongs to a collection, the closing
    reading is a real transcript quote with a timestamp, or the section is
    absent. Never invented.
