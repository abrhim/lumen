---
name: principle-essay
version: 0.2.0
description: Activates when writing or revising a principle essay for Lintel — the long-form doctrinal entries on /principles/:id that replace the one-line descriptions. Encodes the house voice (drawn from Jared Halverson, Todd McLaughlin, and Andrea Woodmansee), the citation discipline, and the specific AI-prose tics that get these rejected. Use for any doctrinal prose that ships to readers, including collection summaries.
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

## Where the voice comes from

Three teachers, all in the corpus, all measured rather than guessed at.

**Jared Halverson** (Unshaken). The text is the spine and the verse number is
the metronome. His method never leaves the page. Borrow him for narrative
passages, for closings, and for granting an objection real weight before
answering it.

**Todd McLaughlin** (Stick of Joseph). Builds a working non-scriptural machine
— entropy, a social contract, an aviation checklist — and then runs scripture
through it. Borrow him for abstract system terms: covenant, priesthood, altar,
repentance.

**Andrea Woodmansee** (Stick of Joseph). Estrangement. She makes a familiar
text stop making sense and then hands you the one withheld fact that resolves
it. Borrow her for openings, for ritual objects, and for anything the reader
thinks they already know.

*Retired in 0.2.0:* v0.1.0 named C. S. Lewis as a second target. He was an
unevidenced one — there is no Lewis corpus in this project to check a draft
against, so the instruction "write like Lewis" produced nothing measurable.
The single thing he stood for, an analogy that carries the argument instead of
decorating it, is preserved below and is now grounded in McLaughlin's borrowed
engine, which we can quote.

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

---

# Pass 1 — Diction

Run this pass on the words. Everything here is countable; if a rule cannot be
checked by counting or by deletion, it does not belong in this pass.

**1.1 — Pick one register and hold it for the whole essay.**
The three sit at different altitudes and they do not mix. McLaughlin renames
institutions as mechanisms — "a covenant structure," "a spiritual domain," "an
order." Halverson stays in objects — shoes, bread, hiking boots, camels.
Woodmansee sits between them and uses a Latinate word only as the *name of an
ancient thing*, glossed in the plainest words available in the same breath:
"they would sign the ketubah. It was like the wedding contract." A paragraph
that visibly mixes all three altitudes reads as a composite, which is exactly
the thing to avoid.

**1.2 — Budget zero intensifiers.**
Halverson's corpus has *amazing* 21 times and *incredible* 20; Woodmansee's has
*really* 81. These are the most visible features of the voice and the cheapest
to copy, and they are not where the warmth lives. Warmth is a structural
expense, paid in Pass 3.

**1.3 — Transitions are deictic or imperative, never logical.**
Count the absences: Halverson uses *however* 3 times, *moreover* 0,
*furthermore* 1 — and that one is inside a quoted letter. Woodmansee has no
*Moreover*, no *Furthermore*, no *Thus*, no *Consequently*, no *In conclusion*
across 26,800 words. What they use instead signals joint movement through
material, not logical relation: *Now.* *So.* *Well.* *Turn with me.* *Keep
reading.* *So that brings us to Thursday.* McLaughlin heads roughly 49 clauses
with `let's` — "let's block it out," "let's pause this and step over and look
at Moses." An essay in this voice that reaches for *therefore* has left the
register. Full replacement table in `teaching-patterns.md`.

**1.4 — Definitions are one short present-tense sentence, verb *is* or
*means*.**
Never "X is defined as." McLaughlin: "an order is a pattern." "sin is
resistance to the spirit or the light of God in any domain." "an altar is how
you traverse a veil." Halverson uses *means* 25 times. Woodmansee gets it in
eight words: "veiling was considered to be a mark of sanctity."

**1.5 — Use deflationary *just* when the term is inflated.**
"righteousness just means that you are rightly aligned to a domain of God."
(McLaughlin.) The word does real work — it tells the reader the definition is
smaller than they were bracing for, which is the whole payoff shape.

**1.6 — Delete every technical term and see if the claim survives.**
If it survives unchanged, the term was a credential. The corpus rule is harsher
than most writers expect. McLaughlin uses *exogenous* exactly once and never
returns to *apophatic*. Halverson uses Hebrew twice in ten episodes, both times
because the English is misleading. Woodmansee has **zero** instances of
*typology*, *exegesis*, *hermeneutic*, *chiasm*, or *epistem-* across 26,800
words, and flags her own limits instead of performing fluency: "and I don't
know if I'm going to pronounce this correctly."

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

**1.10 — Sentence economy: long build, short landing, and never two long
sentences in a row.**
Three independent corpora, three effectively identical distributions.
Halverson: mean 14.4 words, median 12. McLaughlin: mean 13.4, median 10, 25% of
sentences at 5 words or fewer. Woodmansee: mean 14.1, median 10, 25.7% at 5 or
fewer. **The rule:** after any sentence over thirty words, the next sentence is
a question or a verdict, and it is under twelve words. Woodmansee's specimen
verdict is six words: "It's the knowing that's that dividing line."

**1.11 — Build long sentences by accumulation, never by subordination.**
None of the three writes a periodic sentence. They chain with *and*, *so*,
*because*, *which means*, and they extend by listing concrete items or by
climbing a ladder of scope. McLaughlin's ladder: "first it's your spirit body,
and then it's your physical body, and it's the body of your marriage, your
family, your ward, your community, your country." Halverson's terminal triple:
"posterity, priesthood, and promised land." A trailing dependent clause is fine
aloud and broken in print — cut it or promote it.

---

# Pass 2 — Structure and scaffold

Run this pass on the shape. Pass 1 can be fixed by editing; Pass 2 failures
require rewriting, so do this pass on the outline before there is a draft.

**2.1 — The default shape.**
Woodmansee's loop for the skeleton, McLaughlin's mechanics at the center,
Halverson's landing.

1. Open on the familiar thing made strange — one concrete scene or one
   unexplained number.
2. Name the standard reading and grant it a full clause.
3. Build the prerequisite: one machine, one custom, or one etymology. This is
   the longest stretch and it should feel like it is about something else.
4. Define, in one short sentence, present tense, verb *is* or *means*.
5. Cash it out, then test it on the inverse.
6. Land on worry, a question, or a procedure. Do not dwell. Stop.

Step 3 is the part that is hardest to keep and easiest to lose. It looks like
padding to an editor and like digression to a first-draft writer. It is
neither. It is the entire mechanism by which step 4 lands as a reward rather
than as information.

**2.2 — The opening carries the essay, because the reader can abandon a page.**
All three open well; only Woodmansee's opening works on paper. Her form is a
concrete scene plus an accusation of strangeness: "isn't this the weirdest
wedding you've ever heard of?"

*Reconciling this with Abram's standing rule.* v0.1.0 required the essay to
open by saying what the doctrine is, "in a sentence a reader could repeat to
someone else." That rule stands, and it does not conflict with estrangement
once you see which definition goes where: the **received** meaning is the one
that goes early, plainly, in the repeatable sentence — that is step 2, the
grant. The **sharpened** definition is the reward and it arrives at step 4. So
the first two paragraphs give the reader something they can carry, and the
essay then earns something better. What is banned is opening on a *thesis about
the essay* ("Covenants are more expansive than we assume") rather than on a
particular. That is throat-clearing wearing a topic sentence's clothes.

**2.3 — Grade the received reading. Never discard it.**
This is the move that keeps all three from reading as contrarian, which matters
enormously for doctrinal prose. The formula is literally *X is true, and
there's more* — never *X is wrong*, and the standard reading gets a **full
clause of respect** before the pivot.

- McLaughlin: "Two-way promise, right? Which isn't a wrong answer, but it's not
  a sufficient, it's not a comprehensive answer."
- Woodmansee: "certainly all of that is true, but I think there's a big piece
  that we're missing."
- Halverson concedes the underlying value outright — on inclusivity, "and
  that's a good thing" — before he criticizes the overcorrection.

The concession is not tactical politeness. It is what buys the reading that
follows.

**2.4 — Build the prerequisite by one of three routes, chosen by term type.**

- **Prerequisite chain** (McLaughlin, for system terms): dominion, then the
  unseen world, then agency, then veils, and only then altar.
- **Withheld cultural fact** (Woodmansee, for ritual and narrative terms): the
  token at the door, the wooden bolt, the recognition of the voice.
- **Etymology decomposed** (Halverson, for names and loaded words).

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
an incredible place to begin. Verse one..." Nobody writes *we must*. Nobody
writes *let us*. Neither phrase appears anywhere in these corpora.

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

**2.12 — Form constraints (unchanged from 0.1.0).**
No headings, no bullets, no numbered beats. Continuous prose in paragraphs that
each carry one movement of the argument. Six to ten paragraphs, 700–1,100
words. Show the doctrine working on particular people in particular
situations, not in a survey. The examples ARE the argument; a claim that cannot
be shown happening to someone probably is not ready to print. Close on the
reader's situation, not on a summary of what was just said.

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

- Halverson: "Now verse 12 says that Jesse had eight sons. In the book of first
  Chronicles, it says he had seven, so there's some discrepancy there. We don't
  totally know."
- Woodmansee: "whether that's good or bad is the scholars debate."
- McLaughlin: "When I suggest this, I could be just dead wrong, and I'm very
  open to that."

**3.3 — Pick one hedging posture per essay.**
Their three postures are three different theories of authority, and mixing them
makes an essay's authority illegible.

- **McLaughlin hedges the frame, then speaks flatly inside it.** "I hate saying
  this is the definition of this" — and three minutes later, "There's no
  neutral territory ever."
- **Woodmansee grades each claim separately.** "I'm putting forward a theory
  that some Bible scholars would probably discount" sits beside unhedged
  assertions, and the unhedged ones land harder because of it.
- **Halverson barely hedges definitions at all.** He hedges *inferences* —
  "Maybe he wanted both hands free... I don't know" — and states meanings flat.

An essay that hedges its frame *and* grades every claim *and* asserts its
definitions flat reads as nervous rather than careful. And within a posture the
hedge budget is one: Woodmansee's stack — "So it's possible that... I find it
to be very likely that... I think... I believe..." — is three hedges in four
sentences, which is evasion on a page.

**3.4 — Voice the objection instead of asking the reader a question.**
Halverson: "Now that seems exclusivistic though, doesn't it?" This is the prose
replacement for McLaughlin's live elicitation, and it should be used wherever a
live teacher would have turned to the host. Note what Halverson does next: he
lets *exclusivistic, paternalistic, postcolonial* land, and then knocks them
over with two words. "Come on."

**3.5 — Free indirect speech, but punctuate it.**
Halverson drops into unmarked first person for biblical characters: "Oh, great.
It's probably him. He always shows up when you don't want him to." It works on
the page, but it needs punctuation and framing the transcript does not supply.
McLaughlin's ventriloquized adversary voice needs the same repair; without it
his Satan-voice and his own voice run together and become unreadable.

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
Rules 12–18 are new in 0.2.0 and are corpus-derived. Each one is cheap to
commit and instantly recognizable.

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

5. **Citation after every quote, in parentheses.** `(Genesis 17:5)` four
   times a paragraph breaks the rhythm the prose is trying to build. Name the
   source in the sentence when it matters — "when the Lord renames him in
   Genesis 17" — and let the reference ride quietly otherwise.

6. **Monotone sentence length.** Fifteen to twenty-five words, declarative,
   subject-verb, over and over. Vary it or the prose hums.

7. **Abstract nouns doing the work.** "enlargement," "capacity," "provision,"
   "mechanism." Prefer the concrete thing that abstraction stands for.
   "Pharaoh's brickmakers are offered the priesthood" beats "the covenant
   expands their standing."

8. **Em-dash appositives as a rhythm crutch.** Two per essay, maximum.

9. **Throat-clearing.** "It is worth noting," "Importantly," "In essence."
   Cut every one.

10. **Directing the reader's attention** (Abram, 2026-08-19, the one he
    caught fastest). "Watch what it does." "Notice the direction." "It is
    striking how little..." "Consider Abraham." Every one of these is the
    writer tapping the reader on the shoulder because the sentence that
    follows is not trusted to land on its own. Just explain it. If the
    observation is good the reader will notice without being told to, and
    if it is not, the instruction will not save it.

11. **Editorializing about the reader.** "you did not draft the terms and
    could not have." The reader did not ask to be told what they are
    incapable of. State the fact — the terms are God's — and stop.

12. **Warmth ported as adjectives.** *Amazing*, *incredible*, *really*,
    *beautiful*, *profound*. These are the most visible features of the
    spoken voice and the cheapest to copy — Halverson says *amazing* 21
    times, Woodmansee says *really* 81 — and none of the warmth is in them.
    An imitator takes the adjectives, drops the structure, and produces
    enthusiasm without cause. Budget: zero. See Pass 3.

13. **The comprehension hand-back, and its worse conversion.** `Does that
    make sense?` (McLaughlin, near every major beat), `right?` (Woodmansee,
    49 times), `Okay?` and `K?` (Halverson). These invite a listener to say
    no; a reader cannot. Delete them. Do **not** convert them into
    rhetorical questions — "But what does that really mean?" — which is the
    tempting and wrong move. Use the voiced objection instead (Pass 3.4).

14. **Technical vocabulary as a credential.** *Typology*, *hermeneutic*,
    *exegesis*, *chiasm*, *epistemic*, *apophatic*. Woodmansee's 26,800
    words contain zero of the first five. Delete the term; if the paragraph's
    claim survives unchanged, the term was a credential and stays deleted.

15. **The manufactured inversion.** See Pass 3.9. If it was written before
    the argument, it is fake. One per essay, maximum.

16. **Application as exhortation.** *We must.* *Let us.* *May we.* Neither
    of the first two appears anywhere in these corpora. Land on worry, a
    question turned on the reader, or a procedure with the literal words
    supplied.

17. **Estrangement with nothing behind it.** "isn't this the weirdest wedding
    you've ever heard of?" is a **debt**. If you make a text strange and then
    discharge the tension with a fact the reader already had, you have spent
    attention and paid nothing. Every anomaly needs a genuinely withheld
    concrete fact — a custom, a root, an object, a political pressure — or it
    should not be raised.

18. **Restatement for emphasis.** "So all laws have a law of sacrifice that
    are inextricably connected to it. So all laws have sacrifices." Aloud
    that is emphasis; in print it is redundancy. Substitute: give the second
    version its own paragraph and delete the first.

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
Ask for it rather than choosing one. For Covenants he wanted the expansive
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

1. **Withholding.** Does the sharpened definition arrive after the
   prerequisite, not before? If a reader could skip to paragraph two and get
   the whole point, the essay has no shape.
2. **The definition sentence.** Is it one sentence, present tense, verb *is*
   or *means*, and shorter and plainer than the essay's own opening sentence?
3. **The grant.** Does the standard reading get a full clause of respect
   before any pivot? Search the draft for the word *wrong* applied to it.
4. **Sentence economy.** Median sentence at or under 12 words. At least one
   in five under 6 words. No two sentences over 30 words adjacent.
5. **Connective sweep.** Zero instances of *therefore*, *moreover*,
   *furthermore*, *thus*, *consequently*, *in conclusion*, *in essence*,
   *importantly*, *it is worth noting*.
6. **Intensifier sweep.** Zero instances of *amazing*, *incredible*,
   *really*, *profound*, *beautiful*, *powerful* as intensifiers (tic 12).
7. **Attention-direction sweep** (tic 10). Zero instances of *notice*,
   *watch*, *consider*, *observe*, *it is striking*, *note that*.
8. **Exhortation sweep** (tic 16). Zero instances of *we must*, *let us*,
   *may we*, *we should*.
9. **Rhetorical-question sweep** (tic 13). Every question in the draft is
   either a voiced objection or is deferred by at least a paragraph. Zero
   comprehension hand-backs and zero rhetorical questions standing in for
   them.
10. **The analogy test.** Delete the analogy. Does the claim survive? If yes,
    the analogy was decoration — cut it. Is there more than one? Cut to one.
11. **The technical-term test** (tic 14). Delete each technical term. Any
    paragraph whose claim survives unchanged keeps the deletion.
12. **The inversion test** (tic 15). At most one antimetabole, and it appears
    after the argument that earns it, built on a stem already in the essay.
13. **Register.** One altitude held throughout. No paragraph containing both
    McLaughlin-style abstraction (*domain*, *structure*, *order*) and
    Halverson-style objects (*shoes*, *bread*, *camels*).
14. **Hedge posture.** One of the three postures, named to yourself before
    drafting, held throughout. No more than one hedge in any four sentences.
15. **The *we* test.** Every *we* is self-implicating. Swap each for *you*;
    if the meaning is unchanged, rewrite it.
16. **The landing.** Worry, a question turned on the reader, or a procedure.
    Nothing after it. No summary paragraph.
17. **Anomaly debts** (tic 17). Every strangeness raised is discharged by a
    concrete fact the reader did not already have.
18. **Form.** No headings, no bullets, no numbered beats, no bold. Six to ten
    paragraphs, 700–1,100 words. Two em-dashes maximum (tic 8).
19. **Scripture verified.** Every quoted passage checked against
    `lumen.verses` this session, not from memory. Three to eight passages.
20. **Collection quote.** If the essay belongs to a collection, the closing
    reading is a real transcript quote with a timestamp, or the section is
    absent. Never invented.
