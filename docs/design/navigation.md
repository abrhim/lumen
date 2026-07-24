# Navigation — the Composition (design input, rev 2)

Rev 1: 2026-07-22/23, synthesized from the "Seven Navigations" study set
(artifact index `56a94276…`) into **The Composition** (artifact
`a72965aa-408f-4770-a975-b1bdf7fcc31b` — visual companion; reflects rev 1;
this doc governs). Rev 2: 2026-07-23, amended after a five-lens adversarial
design review (product, engineering, internal-consistency, ranking/data,
accessibility — 38 findings) and Abram's rulings on the five open forks.
Abram's rulings are marked throughout.

The governing sentence (Abram, verbatim): **"We should feel like obsidian but
with a spine in holy writ."** An application, not a website. The inversion
that makes it work: Obsidian's vault starts empty; Lumen's comes pre-filled —
canon + graph are given, the personal layer grows on them.

Build note: the search engine this design consumes (`/api/search`, `/search`,
`packages/scripture/src/search.ts`) lives on `main`; all navigation work
branches from `main`, not from older feature branches.

## 1. The verdict

Four elements, no more:

- **The place** — the Desk at `/`, reached from every page by one mark: the
  asterism ⁂, top-left, always. No other global chrome exists on desktop.
- **The gesture** — the Palette on `⌘K` / `/`: one summoned input answering
  every "take me to". It IS the search-UI feature (`/api/search`'s reference
  short-circuit already implements its ranking rule 1).
- **The floor** — phones only: one bottom locator bar. Location in the
  reading serif, progress in the hairline, palette trigger (magnifier at the
  right edge), and — on the media page — the transport. Never two bars.
- **The bare page** — the reader carries ⁂ top-left, a search whisper
  bottom-right, prev/next in content. Nothing else, ever.

Rejected: persistent sidebar (01), top bar (02), desktop bottom dock (04),
hidden edge-summoned workspace (05). Deferred: sliding panes (07) to the
personal-notes era as the study posture.

## 2. Doctrine (the review checklist for every future surface)

1. Chrome states where you are and carries the single summon affordance; it
   never enumerates destinations. (02; rev 2 wording licenses the whisper
   and magnifier explicitly.)
2. **Structure replaces, content branches.** A casual reader must never meet
   a workspace uninvited. (07)
3. **Two bottom bars is the one unforgivable outcome.** Precisely: the floor
   absorbs the media page's bottom **rails bar** (Chapters/References
   relocate to the palette's page-scoped rows); **transport is
   media-page-scoped in v1** — the sticky top video strip persists (its
   iframe must stay mounted for audio), and the floor carries transport
   controls only on that page. A cross-route persistent player is its own
   future feature, not a rider. (04; rev 2 corrected against media.tsx.)
4. Async search results append; they never reorder rows above the cursor —
   and normatively: **appended rows never re-id or renumber rows above the
   highlight and never move `aria-activedescendant`**; appended results are
   deduplicated by destination id against rows already shown. (03 + a11y)
5. Progress fills an existing rule — no new element; a line the page already
   owns starts to carry ink. (02/04)
6. `Esc` closes the innermost open thing and **never eats a chapter**.
   **v1: Esc is inert on a bare chapter** (the Esc-to-Desk hop is deferred
   until the inner rungs have earned trust). Implementation note (binding):
   one LIFO **escape registry** — every openable surface registers a closer
   on open (Radix dialogs via `onEscapeKeyDown` + `preventDefault`; the
   see-all disclosure becomes controlled state); the global listener acts
   only when the registry is empty and `event.defaultPrevented` is false.
   Focus rules per rung: palette → its invoker (⁂ fallback); see-all fold →
   the "See all N" trigger; rail/sheet → the invoking verse control; word
   card → the word. Sibling order: most-recently-opened first. Esc-closing
   the rail does not overwrite remembered posture. (06/07 + eng + a11y)
7. Scent, not signage. Affordances whisper; the fallback for missed scent is
   enriching home, never adding chrome back. (05/03)
8. If a section can't be beautiful as text, it doesn't ship. Words before
   icons, with the taxonomy defined: **typographic marks (⁂ · × → ·) are
   licensed; pictographic icons are banned, with one exception (Abram): the
   magnifier at the floor's right edge; media transport glyphs (▸) are
   player controls, exempt from the navigation rule.** (06/04, amended)
9. Silence is a choice on the menu — the progress figure cycles
   verse-count → time-left → percent → off; the *off* state keeps a
   focusable control named "Progress hidden — tap to show." (04 + a11y)
10. The panel budget is one frame, not one spinner; prefetch at first
    intent. (05)
11. Every gesture has three doors — key, click, touch. The palette is a
    search box before it is a grammar; sigils/shortcuts are optional depth.
    `/search` (shipped on main) remains the browsable long form.
12. **Guided is a posture, not a fork (Abram).** One setting, `Quiet ·
    Guided`, beside the themes. Rule: **volume, never new surfaces** —
    Guided may louden or label existing affordances (labeling an existing
    affordance is a volume change), never add one. Guided = the pre-recede
    state pinned (see §5a, earned quiet). **Accessibility floors are
    posture-independent: nothing in Quiet falls below WCAG AA** — contrast,
    target sizes, focus visibility, reduced-motion behavior. `prefers-
    contrast: more` lifts whisper/mark inks to full in either posture;
    `prefers-reduced-motion` stills recede transitions in either posture.
    Guided is onboarding/attendance, never the accessibility mode. (Abram +
    consistency + a11y rewording.)
13. New features earn **routes, not surfaces**. Notes/collections become
    palette registers, Desk registers, and pages; the registry prints them
    fail-closed. (03/01)
14. **No monospaced all-caps titles — ever. No AI-trending UX dialect. Craft
    only.** (Abram, verbatim, standing.) Monospace only for code identifiers
    in documents.
15. Recede is a state, not an animation: under `prefers-reduced-motion`,
    every recede/appear (whisper fade, sliver transition, mark-label,
    palette entrance, appended-result entrance, theme live-preview) is
    instant, per the shipped `motion-safe`/`matchMedia` pattern. (a11y)

## 3. The Desk (home redesign)

Registers top to bottom; register labels are real headings, DOM order
label-then-content. A register with nothing prints nothing.

- **Masthead** — ⁂ + wordmark, dateline; beneath, one italic title-plate
  line, always: *"A reader for the scriptures, and the web of connections
  inside them."*
- **Where I left off (Abram's naming + semantics)** — medium-agnostic
  resume; whichever was touched last leads. **Doorways navigate, never
  actuate**: the chapter doorway resumes at the verse; the episode doorway
  lands at the timestamp *paused*, transport armed — no surprise audio.
  The doorway is one link with an explicit accessible name ("Resume Alma 32
  at verse 21 — 20 of 43 read"); the fading excerpt is decorative
  (`aria-hidden`); the reference/progress line stays full ink. **"Read" is a
  furthest-verse high-water mark** — one integer per chapter, which is also
  the resume point. **Finished chapter hands forward** ("Finished Alma 32 —
  Alma 33 begins…"). When the last-touched episode DISCUSSES the
  last-touched chapter, the two merge into one doorway with both doors.
  Beneath: "Also open" (recent chapters) and the other medium's resume line.
- **Trails** — recent wanderings as dated sentences (an `<ol>` of trails,
  each hop a typed, dotted link; separators decorative; entity type in the
  accessible name — "Rameumptom (place)"). Recorder specced in §3b.
- **The canon** — contents-page treatment: volume labels in a ledger column,
  books as run-in serif lists with middots.
- **Study** — the entity-type doors as one line; beneath, "resurfaced this
  morning": ~3 graph nodes near recent reading, rotated daily.
- **Foot** — `⌘K` hint; themes as words; **type size as words — Smaller ·
  Standard · Larger (Abram: adopted; current reading typography is too
  small — the default size itself goes up in the same stroke)**; `Quiet ·
  Guided`; account/sign-out. Sign-in invitation lives here and nowhere
  else.
- **Come Follow Me** — two forms (Abram's rulings, both): (a) the no-history
  Desk's **appointed passage defaults to the current CFM chapters** — no
  account, no register, no chrome; (b) the enriched CFM *register* remains
  opt-in for accounts. Needs the ~52-row/year schedule ingest.
- **The Record (future)** — milestone register; exists only when a threshold
  has something to say; prose, never meters; silent between occasions.
- Signed out: same desk on localStorage. The anon resume pointer is
  mirrored into a small cookie (or the doorway ships a deliberate skeleton)
  so SSR can print the lead register without hydration flash; rail posture
  and Quiet/Guided ride the existing pre-paint boot-script pattern.

### 3a. Persistence — the user-state layer (Abram: a real table)

The app is today a read-only client (SELECT-only credential, no write
statements, 1,000/day KV budget). The personal layer gets a real write path,
consistent with the auth plan's SSR-only rule (D1): **RLS-scoped tables
written through the existing per-request SSR Supabase client** (PostgREST
rides the user's JWT; no new DSN; writes go through React Router actions).

v1 schema (lean, three tables):

```sql
CREATE TABLE lumen.user_reading (   -- resume + high-water marks
  user_id uuid NOT NULL,            -- auth.uid()
  kind text NOT NULL,               -- 'chapter' | 'episode'
  ref_id text NOT NULL,             -- 'alma-32' | episode id
  position int NOT NULL,            -- furthest verse | seconds
  touched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, kind, ref_id)
);
CREATE TABLE lumen.user_trail (     -- the recorder's sink (§3b)
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL,
  hops jsonb NOT NULL,              -- [{ref, type, at}, …]
  PRIMARY KEY (user_id, started_at)
);
CREATE TABLE lumen.user_prefs (     -- posture, type size, CFM opt-in
  user_id uuid PRIMARY KEY,
  prefs jsonb NOT NULL DEFAULT '{}'
);
```

RLS: `user_id = auth.uid()` on all three, all operations. Write discipline:
positions are debounced high-water writes (one row per chapter/episode, not
per verse); trails append at session granularity; prefs write on change.
Anonymous users ride localStorage with the same shapes and **merge on
sign-in** (server wins on conflict by `touched_at`). KV is never used for
user state.

### 3b. Trails — the recorder (new subsystem, named)

A **hop** is a navigation initiated from a *typed* row — entity chips,
cross-ref cards, rail rows, palette rows, graph nodes. Those call sites
already know the edge type at click time; they attach it (`{ref, type}`)
to a session trail buffer (localStorage, last N=10 trails × 12 hops),
synced to `user_trail` per §3a when signed in. Plain paging (prev/next,
book→chapter drilling) is not a hop — structure replaces, content branches,
and trails record *branches*. The palette's empty state reads the same
buffer. A visit-frequency ledger for palette frecency (register 3) rides
the same mechanism (per-destination counters, localStorage, optional sync).

### 3c. Earned quiet (Abram: adopted, name provisional)

Recede is **earned per affordance, never timed**. Each quiet-capable
affordance carries a learned bit (in `user_prefs`/localStorage):

| Affordance | Ships attended as | Earns quiet when |
|---|---|---|
| ⌘K whisper | full ink + the word "Search" | first successful palette navigation |
| ⁂ mark | glyph + label "the Desk" | first Desk visit via the mark |
| Floor (mobile) | full bar, never slivers | first palette summon from the floor |
| Palette legend | visible | third successful palette navigation |

"Successful" = the surface was used and a navigation resulted. Guided
(doctrine 12) pins the attended column permanently; switching back to Quiet
resumes the earned state, not zero. First-visit is therefore just the
state where nothing is yet earned — no timers exist anywhere.

## 4. The reader and the rail

Reader: bare page per §1. `]` toggles the rail; posture remembered per
plane; **Guided forces the rail open without writing posture memory**. The
whisper is a real button (`aria-label="Search"`), in tab order, at **the
lightest theme token that passes 4.5:1 contrast** (not a fixed 34%); full
ink on hover/focus; the scroll-reading fade is visual only and reverses on
focus. The ⁂ is a link named "Lumen — the Desk" (glyph `aria-hidden`),
≥44px hit area. Acceptance test: the bare page is keyboard-navigable
everywhere without the palette. **Mobile reader margins shrink (Abram)** —
the current 56px gutter + container padding give back reading width; the
freed gutter also hosts the mobile depth affordance (§6a).

The rail = the shipped verse panel wearing the craft rules (register
anatomy, print-nothing rule, every-row-a-door, degradation-as-absence — as
rev 1, unchanged). Register order (correcting the artifact's Plate II·b,
which drew it wrong): **art · Teaches · Mentions · Heard in ·
Cross-references** — moments read with the entities, per Abram's original
panel-order amendment; the shipped order stands. The "See all" door's N is
the rendered row count, not the SQL total. Plus: **"See all" is disclosure,
never navigation** —
in-place, inside the rail's scroll, URL/back untouched, `Esc` folds it
first with focus returning to the trigger; the disclosure is *controlled*
state so the escape registry can observe it. Growth registers (Conference,
Your notes) unchanged. Cross-reference ordering per
`docs/design/edge-ranking.md` rev 2.

## 5. The Palette (search-UI feature spec source)

Grammar, ranking law, empty state, registers — as rev 1, plus the panel's
bindings:

- **ARIA contract**: an `aria-modal` dialog; one input, `role="combobox"`
  with `aria-expanded`/`aria-controls` → `role="listbox"`; rows are
  `role="option"` with stable ids; roving highlight via
  `aria-activedescendant` (DOM focus never leaves the input). One
  visually-hidden polite status region announces debounced counts and late
  arrivals ("6 more from full text, below"). The `/` shortcut never fires
  from an editable field.
- **Destination index, scoped and sized**: books (87) + episode titles +
  the six typed entity slugs (~7.5k rows); chapter rows synthesized
  client-side from per-book chapter counts; served by a new
  **public-collections-only resource route** (no session variance →
  edge/KV-cacheable under a version key). Topics, Strong's words, and art
  route through register 5 (`/api/search`). Register 1 needs no server —
  `parseReference` already ships client-side.
- Frecency (register 3) reads the §3b ledger. Register 5 appends
  **deduplicated by destination id** (doctrine 4).
- Theme live-preview: applies on a ~250ms dwell (not per arrow-step), no
  crossfade under reduced motion, Esc reverts, status region announces
  ("Previewing: Ink").

## 6. The floor (mobile)

One element, **explicit tap regions** (three-plus targets, one visual bar,
each ≥44px inside safe-area): ▸ transport toggle (media page only) ·
location text · cycling figure (doctrine 9; announced through the floor's
status region; accessible name carries value + affordance) · magnifier
(`aria-label="Search"`) + remaining width → palette sheet. The floor
trigger's accessible name carries location ("Search — Alma 32"). Sheet:
input docked above the keyboard, results stacking upward. Second summons:
overscroll at top.

Scroll-down → **the slivered state keeps only the hairline** (the progress
rule the page already owns — doctrine 5); the full floor re-arrives on
scroll-up or overscroll, matching Safari's own grammar. The collapsed
state keeps its role and name ("Search and location, collapsed") with a
≥44px invisible hit extension. Positioning is `visualViewport`-driven;
acceptance criteria include a physical-device checklist for Safari's
two-tap bottom-edge behavior and URL-bar resize bounce. Guided never
slivers (§3c).

### 6a. The mobile depth affordance (Abram: "expand on this" — expanded)

The modal first contact is a phone-borne deep link, and on mobile the
shipped reader shows *zero* depth signal (dots are `lg:`-only). Four
mechanisms, composed rather than chosen:

1. **Connected-verse number treatment (primary, always on).** Verse numbers
   whose verses carry connections take a slightly deeper ink and a hairline
   underline tick — the dots' information moved into an element that
   already exists at every width. Zero new chrome; color is not the sole
   carrier (weight + tick), per 1.4.1.
2. **Gutter dots return on mobile** once §4's margin reduction lands — the
   freed gutter hosts a compact single-dot variant (one dot = "depth
   exists," not the full type spread; the full spread stays desktop).
3. **The figure's cycle gains a connections state** — "v. 20 of 43" → "12
   connected verses" → time-left → off — putting depth literally on the
   floor's odometer.
4. **The attended/Guided louden**: on first visit (and always under
   Guided), the first connected verse in view carries a one-line inline
   whisper — *"3 connections — tap the verse"* — rendered once, in type,
   never a coach-mark overlay.

Primary metric (replacing Desk-visits): **"engaged any depth affordance"**
(verse tap, rail open, palette summon); Desk visits are secondary.

## 7. Open questions / risks carried forward

1. **Label idiom**: shipped uppercase-tracked `font-ui` labels vs the
   Composition's italic-serif register — decide before the Desk build;
   whichever wins applies everywhere (doctrine 14 bans only mono-caps).
2. Esc-to-Desk from a bare chapter: deferred by doctrine 6 (v1 inert);
   revisit after the escape registry has shipped and earned trust.
3. The cross-route persistent player (audio surviving navigation) — real
   feature, explicitly out of v1 (doctrine 3).
4. "Earned quiet" naming — Abram to christen.
5. The graph entrance (first-visit-only, Christ-centered, betweenness-
   curated, arriving with 05's bow) — parked until Desk + palette exist.

## 8. Sequencing (rev 2)

1. **Palette = the search-UI feature** (branch from `main`). Includes: the
   destination-index resource route, the escape registry (its first two
   clients: palette, see-all), frecency ledger, ARIA contract, whisper.
   `/search` already exists on main; palette and page share one result
   renderer.
2. **Desk = the home redesign.** Includes: §3a persistence tables +
   actions, §3b trail recorder (click-site typing), earned-quiet bits,
   CFM appointed passage, type-size setting + reading-size bump.
3. **The floor** — its own stroke, not a rider: floor + §6a depth
   affordances + mobile margin reduction + media rails-bar absorption
   (Chapters/References → palette scoped rows; transport stays on the
   media page).
4. Later, on their own clocks: chrome deletion after the Desk exists;
   Panes with personal notes; the entrance + bow; The Record; the
   persistent player.

## 9. Review provenance

Rev 2 incorporates the 2026-07-23 five-lens panel (38 findings; three-way
convergence on the floor/absorption mis-spec; empirical probes on votes,
degrees, and hub fan-outs — see edge-ranking.md rev 2). Abram's five
rulings: persistence = real DB tables (§3a); earned recede adopted and to
be defined/named (§3c); CFM appointed passage adopted (§3); mobile depth
affordance expanded (§6a); type size adopted + base typography up + mobile
margins down (§3 foot, §4).
