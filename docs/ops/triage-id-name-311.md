# Item 7 triage — full classification of the 311 id↔name first-token mismatches

Spec: `docs/ops/remediation-plan.md` v2, item 7 ("Probe + triage"). Input:
the scan dump `{id, name, entity_type, descr}` for all 311 rows (311/5,904
first-token mismatches; 133 person, 178 place). Triage date: 2026-07-21.

**Method + honesty statement.** Classification was done offline from the
dump alone plus canonical-text knowledge (KJV / BoM / D&C / PGP). NO
database probes were run (item-7 build rule: no PG/Neo4j connections). Per
spec, `descr` is the tiebreaker for which of id vs name is wrong: when name
and descr agree against the id, the id is the outlier (the gilbert/bennett
pattern). Every proposed fix below is gated on the standard pre-flight
probe under item 7's protocol (edge count + verse anchors) before any
write; zero-edge entities follow the proven gilbert path (rename +
`metadata.neo4j_id` stamp). Rows where the dump alone cannot decide are
classed **unclear** with a stated resolution path rather than guessed.

## Class definitions

- **(a) benign-variant** — name is an alternate KJV spelling /
  transliteration / translation of the id's referent, OR id and name are
  the same designation modulo tokenization (possessives, hyphens,
  articles, word order, case, namespace/type prefixes `person:` /
  `place-` / `city-` / `mount-`). Same referent; no action.
- **(b) descriptive** — one side is a descriptive phrase / epithet /
  periphrasis for the referent the other side names ("Wife of Urias",
  "The City", "Pul" for `king-of-assyria-1`). Same referent; no action.
- **(c) NEEDS-FIX** — id and name denote DIFFERENT referents (the
  gilbert/bennett class). Fix proposed per row; which field is wrong is
  stated.
- **(d) unclear** — dump evidence insufficient; resolution path stated.

## Summary

| Class | Count |
|---|---|
| (a) benign-variant | 269 |
| (b) descriptive | 22 |
| (c) NEEDS-FIX | 12 (1 already ledgered: `a-sidney-gilbert-1`) |
| (d) unclear | 8 |
| **Total** | **311** |

Structural note: 168 of the 311 (54%) are pure namespace-prefix artifacts —
118 `place-…-1` rows + 2 `place:` rows (a Genesis curated-place batch with
NASB-flavored notes) and 48 `person:` rows, where the scan's "first token"
is the prefix itself. Of those 168, 164 are benign, 2 descriptive
(`place-earth-2`, `place-heaven-2` — the two symmetric Gen 1 "God called"
rows, classed identically), 1 NEEDS-FIX (`person:ezra-2` → "Meremoth"),
1 unclear (`place-na`). The scan's raw count therefore overstates risk by ~9×; the
real conflict class is 12 rows (3.9%), of which 11 are new.

## The four review-flagged pairs — explicit verdicts

1. **`abdon-1` → "Hanoch" — NEEDS-FIX (id wrong).** Descr: "Son of
   Reuben, listed among those who came into Egypt with Jacob" — that is
   Hanoch, Gen 46:9 (also Ex 6:14, Num 26:5, 1 Chr 5:3). Abdon is a
   different referent entirely (the judge, Judg 12:13–15; Benjaminites,
   1 Chr 8:23,30; a Levitical city, Josh 21:30). Name + descr agree
   against the id → rename id to a `hanoch-*` slug.
2. **`enoch-2` → "Enosh" — NEEDS-FIX (id wrong).** Descr: "Son of Seth
   … Adam to Noah in the Chronicles record" — that is Enosh, 1 Chr 1:1
   (KJV "Enosh"; Gen 4:26 KJV "Enos"). Enoch is the son of Jared, a
   provably distinct Gen 5 / 1 Chr 1 patriarch (the spec's own note).
   Name + descr agree against the id → rename id to an `enosh-*`/`enos-*`
   slug (merge if a biblical Enos entity already exists — see routes 1–2
   below).
3. **`aha-1` → "Agee" — NEEDS-FIX (id wrong).** Descr: "Father of
   Shammah, one of David's mighty men, identified as a Hararite" — that
   is Agee, 2 Sam 23:11, exactly. "Aha" matches NO scriptural figure (a
   garbled/truncated slug; nearest real names are Aharah 1 Chr 8:1,
   Ahasbai 2 Sam 23:34, and the Jaredite king "Ahah" Ether 1:9 — none of
   which the descr supports, and none of which slug to "aha"). Name +
   descr coherent, id denotes nothing → rename to `agee-1`. Pre-flight
   must confirm anchors are 2 Sam 23:11 (not Ether) to exclude the Ahah
   near-collision.
4. **`ephron-1` → "Ephrath" — NEEDS-FIX (id wrong).** Descr: "the woman
   Caleb took after the death of Azubah; she bore him Hur … Caleb-
   ephratah" — that is Ephrath, 1 Chr 2:19,24, female. Ephron is the
   Hittite who sold Machpelah (Gen 23) or the place-names (Josh 15:9,
   2 Chr 13:19) — a different referent. Name + descr agree against the
   id → rename to `ephrath-1`. Pre-flight: if this row's edges turn out
   to be Gen 23 Hittite edges, flip to the name-correction branch (the
   naomi-1 pattern below) instead of renaming.

All four are confirmed real conflicts — none dissolves into a spelling
variant.

## NEEDS-FIX — 12 rows, three delivery routes

Standard pre-flight per entry (item 7 protocol, mirrors gilbert): probe
edge count + verse anchors; **if the edge-set matches the id's referent,
the row is a name/descr overwrite → fix the name; if it matches the name's
referent (or edges = 0), the id is the mint error → rename**; if the
rename target already exists, the entry is a MERGE and must NOT enter the
rename ledger (route 2 below) — merges converge through item 3's ledger +
merge-aware upsert machinery instead (which applies to entity ids AND edge
endpoints). Suffixes below are best-guess; bump to the next free suffix on
collision.

The 12 rows route three ways. `a-sidney-gilbert-1` → `john-c-bennett-1` is
ALREADY in the live ledger (`scripts/entity-renames.json`) and is
deliberately OMITTED from the fragment below: re-appending it would fail
`validateLedger` (`duplicate from` + `duplicate target`) and exit 1 before
any work.

### Route 1 — appendable rename-ledger fragment (9 entries)

The fragment is shaped for the applier as-is. `validateLedger` in
`scripts/migrate-entity-rename.mjs` requires a flat top-level JSON array of
objects carrying EXACTLY `from` and `to` — any other key is HARD-rejected
(`unknown keys`), so no referent/pre-flight metadata may ride along in the
JSON; that context lives in the prose table beneath instead. Append these
entries INTO the existing top-level array in `scripts/entity-renames.json`
(merge arrays — do not nest, do not re-add gilbert):

```json
[
  { "from": "abdon-1", "to": "hanoch-1" },
  { "from": "aha-1", "to": "agee-1" },
  { "from": "enoch-2", "to": "enosh-1" },
  { "from": "ephron-1", "to": "ephrath-1" },
  { "from": "joseph-knight-sr-1", "to": "josiah-stoal-1" },
  { "from": "lysias-1", "to": "lysanias-1" },
  { "from": "person:ezra-2", "to": "person:meremoth-1" },
  { "from": "tertullus-1", "to": "tertius-1" },
  { "from": "zethar-1", "to": "zetham-1" }
]
```

Two entries are CONDITIONAL on the collision probe: `enoch-2` (a biblical
Enos entity may already exist) and `person:ezra-2` (a Meremoth entity very
likely exists). If the probe finds the target occupied, PULL the entry from
this fragment and move it to route 2 — an occupied `to` id left in the
ledger scan-aborts the ENTIRE applier run (exit 2), blocking the clean
renames (see route 2).

Per-entry referent + pre-flight (kept out of the JSON because the applier
rejects unknown keys):

| from → to | wrong field | referent | pre-flight |
|---|---|---|---|
| `abdon-1` → `hanoch-1` | id | Hanoch son of Reuben (Gen 46:9) | hanoch-1 may be held by Hanoch of Midian (Gen 25:4) — bump suffix; merge if a Hanoch-son-of-Reuben entity exists; check whether a legit Abdon entity is expected elsewhere |
| `aha-1` → `agee-1` | id | Agee father of Shammah the Hararite (2 Sam 23:11) | confirm anchors are 2 Sam 23:11, excluding Jaredite Ahah (Ether 1:9) |
| `enoch-2` → `enosh-1` | id | Enosh son of Seth (1 Chr 1:1; Gen 4:26 KJV "Enos") | CONDITIONAL — biblical Enos may already exist as `enos-1` (KJV Gen/Luke spelling): if so this is a MERGE, move to route 2; `person:enos-1` is the Book of Mormon Enos, a different person in a different namespace — do NOT merge into that |
| `ephron-1` → `ephrath-1` | id | Ephrath wife of Caleb (1 Chr 2:19,24) | if edges are Gen 23 Ephron-the-Hittite edges, flip to name-correction (route 3 pattern); place-bethlehem-1 is also named "Ephrath" but is a place — no person-namespace collision expected |
| `joseph-knight-sr-1` → `josiah-stoal-1` | id | Josiah Stoal (JS-H 1:56 spelling; "Stowell" elsewhere), the Chenango-county silver-mine employer | Joseph Knight Sr. is a distinct historical person (D&C 12; Colesville) — if this row's edges are Knight edges, flip to name-correction; decide Stoal-vs-Stowell slug against corpus spelling |
| `lysias-1` → `lysanias-1` | id | Lysanias tetrarch of Abilene (Luke 3:1) | Lysias = Claudius Lysias (Acts 23–24), a different man — confirm no separate claudius-lysias entity claims this id's mentions |
| `person:ezra-2` → `person:meremoth-1` | id | Meremoth son of Uriah, weigher of the temple silver/gold (Ezra 8:33; Neh 3:4,21) | CONDITIONAL — a Meremoth entity very likely already exists (he recurs in Nehemiah): expect MERGE, move to route 2; a genuine second Ezra (the priest, Neh 12:1) exists in-corpus, so person:ezra-2 may later be legitimately re-minted |
| `tertullus-1` → `tertius-1` | id | Tertius, amanuensis of Romans (Rom 16:22) | Tertullus = the orator prosecuting Paul (Acts 24:1-2), a different man — confirm anchors are Rom 16:22 |
| `zethar-1` → `zetham-1` | id | Zetham son of Jehieli, over the treasures (1 Chr 26:22) | Zethar = a chamberlain of Ahasuerus (Esth 1:10), a different man — confirm anchors are 1 Chr 26:22 |

### Route 2 — merge candidates: must NOT enter `entity-renames.json` until the collision probe clears them

The applier's `classifyRename` returns `to_id_occupied` for any entry
whose `to` id is a live entity; the pre-tx scan counts that a failure and
exits 2 BEFORE any transaction — one occupied target halts the WHOLE run,
including every clean rename. And because item 3's writer reads this exact
file, a parked merge entry poisons every future item-7 run until removed.
Merges go through item 3's merge-aware machinery, never this ledger.

- **`zoram-2` → existing `zerubbabel-1` — definite merge.** zerubbabel-1
  is live in this very dump (row 309, Luke's genealogy); descr = Zerubbabel
  in Matt 1:13 ("Zorobabel begat Abiud") — same person. BUT if zoram-2's
  edges turn out to be Book of Mormon Zoram edges, flip to name-correction
  (the naomi-1 pattern, route 3) and relink the Matt 1:13 mention.
- **`enoch-2` merge branch.** If a biblical Enos entity already exists
  (`enos-1`), the route-1 entry becomes a merge into it — pull it from the
  fragment and land it here. Do NOT merge into `person:enos-1` (BoM Enos,
  different person, different namespace).
- **`person:ezra-2` merge branch.** A Meremoth entity very likely already
  exists (recurs in Nehemiah) — expect this to convert from route 1 to a
  merge at probe time.

### Route 3 — name-correction (NO existing applier)

- **`naomi-1`: name is the wrong field, not the id.** Descr describes RUTH
  (Matt 1:5 "mother of Obed by Booz", Moabite) — but a correct Ruth entity
  already exists (`person:ruth-1`, row 135), so renaming naomi-1 would mint
  a duplicate. Likely failure: entity-linking overwrite (the Matt 1
  extraction linked "Ruth" onto naomi-1 and clobbered name+descr). Action:
  restore name "Naomi", regenerate descr, relink the Matt 1:5
  mention/edges to the Ruth entity. Pre-flight: naomi-1's edge-set should
  be Naomi-shaped (mother-in-law relations); if instead ALL edges are
  Ruth's, flip to rename+merge into `person:ruth-1` (route 2).
  **No applier exists for name-corrections** — `migrate-entity-rename.mjs`
  renames ids only. OPEN QUESTION for the ratifier: approve a
  name-correction protocol (escrowed name/descr restore + mention relink)
  before any tooling is written; do not shoehorn this row into the rename
  ledger.

Notes for the ratifier on this section:

- 11 of 12 are new (gilbert already ledgered; omitted from the route-1
  fragment, mentioned in prose only). 9 land in the route-1 fragment
  (7 unconditional + 2 conditional on the collision probe), 1 is a
  definite merge (`zoram-2` → existing `zerubbabel-1`, route 2), 1 is a
  name-correction (`naomi-1`, route 3).
- Seven of the new finds (`joseph-knight-sr-1`, `lysias-1`, `naomi-1`,
  `person:ezra-2`, `tertullus-1`, `zethar-1`, `zoram-2`) were NOT in the
  review's four flagged pairs — the flag list was a sample floor, as the
  spec suspected.
- Namespace conventions are mixed in this corpus (bare `abdon-1`,
  `person:ezra-2`, `place-…-1`); each `to` follows the convention of its
  `from` row.
- After fixes land, the sweep's untriaged-inventory pin (310) can be
  re-based: 291 verified-benign (269 a + 22 b), 11 fixed across the three
  routes above, 8 unclear pending their stated probes.

## Unclear — 8 rows with resolution paths

| id | name | What would resolve it |
|---|---|---|
| `hodaviah-3` | Hod | Empty descr. Hod (1 Chr 7:37, Asherite) is not an attested variant of Hodaviah. Probe verse anchors: 1 Chr 7:37 → id wrong, rename to `hod-1`; a Hodaviah verse (1 Chr 5:24 / 9:7 / Ezra 2:40) → name wrong, restore "Hodaviah". |
| `hoshaiah-2` | the Maacathite | Empty descr. Standard harmonization equates "the Maachathite" (father of Jaazaniah, 2 Kgs 25:23) with Hoshaiah (father of Jezaniah, Jer 42:1) — if anchors are those verses this is a benign gentilic epithet for the same father; any other anchor set means a conflict. Probe anchors. |
| `joseph-12` | Barnabas | Empty descr. Acts 4:36 Joses/Joseph surnamed BARNABAS = benign alternate name; but Acts 1:23 Joseph called BARSABAS is a distinct man. Probe anchors: 4:36 → benign; 1:23 → NEEDS-FIX rename to the Barsabbas entity. |
| `judah-1` | Juda | Descr = "son of Joanna" = the minor Lucan ancestor (Luke 3:26–27), NOT the patriarch. If `judah-1` is the patriarch elsewhere in the graph (likely, given `-1`), this is the naomi-1 overwrite pattern: mint a separate Lucan-Juda entity, restore name/descr, relink Luke 3:26. Probe `judah-1`'s edges/anchors to confirm which referent owns the id. |
| `mount-zemaraim` | Zemaraim | Descr = the Benjaminite CITY (Josh 18:22); the id denotes MOUNT Zemaraim (2 Chr 13:4, in mount Ephraim) — related but distinct geography. Probe anchors: only Josh 18:22 → rename id to a city slug; both → split into two entities. |
| `place-na` | NA | Junk placeholder, not a referent conflict: descr is a curator note ("Canaan here is the person rather than the place"). Not a rename candidate. Resolve by edge probe: expect 0 edges → DELETE under item 7's escrowed protocol. |
| `shuah-1` | Shua (daughter of) | Father/daughter ambiguity: Shuah is the Canaanite FATHER (Gen 38:2,12); "daughter of Shua" is Judah's WIFE (1 Chr 2:3) — distinct referents, and the descr is internally contradictory (calls the Canaanitess both the wife's mother and the mother of Er/Onan/Shelah). Probe anchors + edges (married-to-Judah edge → wife); then either fix name to "Shuah" (father) or split into father + wife entities. |
| `yhvh-2` | Father in heaven | Empty descr. Under this corpus's own theology YHWH/Jehovah = the Son, distinct from the Father — id and name may denote different divine persons, but deity modeling is a curatorial convention. Resolve by checking the `yhvh-1`/`yhvh-2` convention and anchors, then fix per the ontology's intended deity model. Do not silently pass as benign. |

## Full 311-row classification

Legend: a = benign-variant, b = descriptive, c = NEEDS-FIX, d = unclear.

| # | id | name | class | reason |
|---|---|---|---|---|
| 1 | a-sidney-gilbert-1 | John C. Bennett | c | Different people; descr = Bennett (D&C 124); already ledgered → john-c-bennett-1 |
| 2 | abdon-1 | Hanoch | c | Descr = Hanoch son of Reuben (Gen 46:9); Abdon is a different referent — id wrong |
| 3 | abednego-1 | Abed-nego | a | Hyphenation only |
| 4 | achan-1 | Achar | a | 1 Chr 2:7 KJV "Achar"; descr itself states same man as Achan |
| 5 | aha-1 | Agee | c | Descr = Agee father of Shammah (2 Sam 23:11); "Aha" matches no scriptural figure — id wrong |
| 6 | ascent-of-akrabbim | Maaleh-acrabbim | a | KJV transliteration of "ascent of Akrabbim" (Josh 15:3) |
| 7 | bathsheba-1 | Wife of Urias | b | Matt 1:6 periphrasis for Bathsheba; descr confirms |
| 8 | bethel | Beth-el | a | Hyphenation only |
| 9 | bethlehem-city | The City | b | Ruth narrative's "the city" = Bethlehem; descr confirms |
| 10 | boaz-1 | Booz | a | KJV NT spelling (Luke 3:32) |
| 11 | canaan | Chanaan | a | KJV NT spelling (Acts 7:11) |
| 12 | canaan-valley | The Valley | b | Num 14:25 "the valley"; descr confirms same referent |
| 13 | canaanite-woman-1 | Woman of Canaan | a | Same designation reordered (Matt 15:22) |
| 14 | cezorams-son-1 | Son of Cezoram | a | Same designation reordered (Hel 6:15) |
| 15 | chaldea | Land of the Chaldaeans | a | Expanded KJV designation of the same region |
| 16 | city-adam | Adam | a | id carries city- disambiguator; the city Adam (Josh 3:16) |
| 17 | city-of-nauvoo | Nauvoo | a | id qualifier prefix; same city |
| 18 | egypt-city | The City | b | Gen 44's "the city" in Egypt; descr confirms |
| 19 | eliphalet-1 | Eliphelet | a | KJV spelling variants of the same Benjaminite (1 Chr 8:39) |
| 20 | enoch-2 | Enosh | c | Descr = Enosh son of Seth (1 Chr 1:1); Enoch = son of Jared, distinct patriarch — id wrong |
| 21 | entrance-of-hamath | Hamath | a | Shortened proper form of the "entering in of Hamath" boundary marker (Josh 13:5) |
| 22 | ephron-1 | Ephrath | c | Descr = Ephrath wife of Caleb (1 Chr 2:19); Ephron = the Hittite/places — id wrong |
| 23 | epimenides-1 | Cretan Prophet | b | Titus 1:12 epithet for Epimenides; descr confirms |
| 24 | eshtemoa | Eshtemoh | a | KJV variant (Josh 15:50) |
| 25 | euphrates-river | The River | b | Ezra 5–6 "beyond the river" usage; descr confirms Euphrates |
| 26 | ezem | Azem | a | KJV variant (Josh 15:29) |
| 27 | fullers-field | Fuller's Field | a | Apostrophe tokenization |
| 28 | gershon-1 | Gershom | a | Chronicles calls Levi's son Gershom (1 Chr 6:16-17); descr confirms same clan founder |
| 29 | hamans-house | Haman's House | a | Apostrophe tokenization |
| 30 | hephzibah-1 | Hephzi-bah | a | Hyphenation (2 Kgs 21:1) |
| 31 | hizkiah-1 | Hizkijah | a | KJV variant (Neh 10:17); descr matches covenant sealer |
| 32 | hodaviah-3 | Hod | d | Empty descr; Hod (1 Chr 7:37) not an attested Hodaviah variant — resolve via anchors |
| 33 | hoshaiah-2 | the Maacathite | d | Empty descr; benign only under the 2 Kgs 25:23 / Jer 42:1 father harmonization — resolve via anchors |
| 34 | israelite-camp | The Camp | b | Wilderness narrative's "the camp"; descr confirms |
| 35 | israelite-maid-1 | Little Maid of Israel | a | Same designation reordered (2 Kgs 5:2) |
| 36 | jaazer | Jazer | a | KJV variants (Num 21:32 / Josh 21:39) |
| 37 | jacobs-well | Jacob's Well | a | Apostrophe tokenization |
| 38 | jahaz | Jahzah | a | KJV variant (1 Chr 6:78) |
| 39 | jared-1 | Jered | a | 1 Chr 1:2 KJV "Jered"; descr = son of Mahalaleel, same patriarch |
| 40 | jecoliah-1 | Jecholiah | a | KJV variant (2 Kgs 15:2) |
| 41 | jehoram-judah-1 | Joram | a | Matt 1:8 KJV "Joram", same king of Judah |
| 42 | jehoshaphat-1 | Josaphat | a | Matt 1:8 KJV "Josaphat" |
| 43 | jeroboams-wife-1 | Wife of Jeroboam | a | Same designation reordered (1 Kgs 14) |
| 44 | jerusalem-temple | The Temple | b | Gospels' "the temple"; descr confirms |
| 45 | jobs-wife-1 | Job's Wife | a | Apostrophe tokenization |
| 46 | john-beloved-1 | The Beloved Disciple | b | Traditional identification; id encodes it, name keeps the text's designation |
| 47 | josedech-1 | Jehozadak | a | Josedech (Hag 1:1) = Jehozadak (1 Chr 6:14-15); descr matches |
| 48 | joseph-12 | Barnabas | d | Empty descr; Acts 4:36 Joseph/Joses = Barnabas (benign) vs Acts 1:23 Joseph Barsabas (conflict) — resolve via anchors |
| 49 | joseph-knight-sr-1 | Josiah Stoal | c | Descr fully describes Josiah Stoal (JS-H 1:56); Joseph Knight Sr. is a different man — id wrong |
| 50 | josephs-house | Joseph's House | a | Apostrophe tokenization |
| 51 | joshua-1 | Jeshua the son of Nun | a | Neh 8:17 form of Joshua |
| 52 | judah-1 | Juda | d | Descr = Juda son of Joanna (Luke 3:26-27), not the patriarch — probe which referent owns judah-1 |
| 53 | king-of-assyria-1 | Pul | b | Descriptive id, proper name; same king (2 Kgs 15:19); descr confirms |
| 54 | kingdom-of-sihon | Country of Sihon | a | Same designation, phrasing variant |
| 55 | kings-court | The King's Court | a | Apostrophe/article tokenization |
| 56 | kings-dale | King's Dale | a | Apostrophe tokenization |
| 57 | kings-forest | King's Forest | a | Apostrophe tokenization |
| 58 | kings-garden | King's Garden | a | Apostrophe tokenization |
| 59 | kings-gate | The King's Gate | a | Apostrophe/article tokenization |
| 60 | kings-high-house | King's High House | a | Apostrophe tokenization |
| 61 | kings-house | King's House | a | Apostrophe tokenization |
| 62 | kings-pool | King's Pool | a | Apostrophe tokenization |
| 63 | kiriathaim | Kirjathaim | a | KJV variant (Josh 13:19) |
| 64 | lamonis-father-1 | Father of Lamoni | a | Same designation reordered (Alma 20) |
| 65 | lamonis-wife-1 | Queen of Lamoni | b | Wife-slug vs the text's "queen" designation; same person (Alma 19) |
| 66 | lords-house-court | Court of the Lord's House | a | Same designation reordered (Jer 19:14) |
| 67 | lots-wife-1 | Lot's Wife | a | Apostrophe tokenization |
| 68 | lysias-1 | Lysanias | c | Descr = Lysanias tetrarch of Abilene (Luke 3:1); Lysias = Claudius Lysias (Acts 23) — id wrong |
| 69 | malchiah-1 | Malchijah | a | KJV variant (Neh 10:3) |
| 70 | malchishua-1 | Malchi-shua | a | Hyphenation |
| 71 | manoahs-wife-1 | Manoah's Wife | a | Apostrophe tokenization |
| 72 | mehetabeel-1 | Mehetabel | a | Spelling variant; descr = Hadad's wife (Gen 36:39) consistent with name — note: Neh 6:10 "Mehetabeel" is a different man; if anchors include Neh 6:10, re-examine |
| 73 | melchishua-1 | Melchi-shua | a | Hyphenation |
| 74 | meshillemoth-1 | Meshillemith | a | 1 Chr 9:12 / Neh 11:13 variants of the same priestly ancestor; descr matches |
| 75 | micahs-mother-1 | Micah's Mother | a | Apostrophe tokenization |
| 76 | mount-seir | Seir | a | Shortened form; descr = the Edomite mountain region |
| 77 | mount-zemaraim | Zemaraim | d | id = the mount (2 Chr 13:4), descr = the Benjaminite city (Josh 18:22) — probe anchors, possibly split |
| 78 | mountain-nebo | Nebo | a | id qualifier; same peak (Num 33:47) |
| 79 | mountain-of-judah | Hill Country of Judah | a | Same designation, translation phrasing |
| 80 | nachons-threshingfloor | Nachon's Threshingfloor | a | Apostrophe tokenization |
| 81 | nahor-2 | Nachor | a | Luke 3:34 KJV "Nachor" |
| 82 | nahshon-1 | Naasson | a | Luke 3:32 KJV "Naasson" |
| 83 | naomi-1 | Ruth | c | Descr = RUTH (Matt 1:5), not Naomi; a correct Ruth entity exists — NAME wrong (overwrite), restore "Naomi" + relink |
| 84 | nebajoth-1 | Nebaioth | a | KJV variants (Gen 25:13 / 1 Chr 1:29) |
| 85 | nebuzaradan-1 | Nebuzar-adan | a | Hyphenation |
| 86 | noah-1 | Noe | a | Luke 3:36 KJV "Noe" |
| 87 | pauls-nephew-1 | Paul's Nephew | a | Apostrophe tokenization |
| 88 | peleg-1 | Phalec | a | Luke 3:35 KJV "Phalec" |
| 89 | person:alma-1 | Alma | a | Namespace-prefix artifact; name matches id slug |
| 90 | person:alma-2 | Alma the Younger | a | Prefix artifact + epithet; descr confirms the younger Alma |
| 91 | person:amos-1 | Amos | a | Prefix artifact; name matches slug |
| 92 | person:amos-2 | Amos (son of Amos) | a | Prefix artifact + disambiguator (4 Ne 1:21); descr confirms |
| 93 | person:dan-1 | Dan | a | Prefix artifact; name matches slug |
| 94 | person:enos-1 | Enos | a | Prefix artifact; name matches slug (BoM Enos) |
| 95 | person:ether-1 | Ether | a | Prefix artifact; name matches slug |
| 96 | person:ezra-1 | Ezra | a | Prefix artifact; name matches slug |
| 97 | person:ezra-2 | Meremoth | c | Descr = Meremoth son of Uriah (Ezra 8:33); not any Ezra — id wrong (likely merge into existing Meremoth) |
| 98 | person:hosea-1 | Hosea | a | Prefix artifact; name matches slug |
| 99 | person:jacob-1 | Jacob | a | Prefix artifact; name matches slug |
| 100 | person:jacob-2 | Jacob | a | Prefix artifact; properly-numbered second Jacob (3 Ne 7 dissenter-king per descr) |
| 101 | person:james-1 | James | a | Prefix artifact; name matches slug |
| 102 | person:james-2 | James the son of Alphaeus | a | Prefix artifact + disambiguator; descr confirms |
| 103 | person:james-3 | James | a | Prefix artifact; name matches slug (empty descr, but no id↔name conflict) |
| 104 | person:james-4 | James | a | Prefix artifact; name matches slug |
| 105 | person:jarom-1 | Jarom | a | Prefix artifact; name matches slug |
| 106 | person:job-1 | Job | a | Prefix artifact; name matches slug |
| 107 | person:joel-1 | Joel | a | Prefix artifact; name matches slug |
| 108 | person:joel-2 | Joel | a | Prefix artifact; name matches slug |
| 109 | person:joel-3 | Joel | a | Prefix artifact; name matches slug |
| 110 | person:john-1 | John | a | Prefix artifact; name matches slug |
| 111 | person:john-2 | John | a | Prefix artifact; name matches slug |
| 112 | person:john-3 | John | a | Prefix artifact; name matches slug |
| 113 | person:john-4 | John | a | Prefix artifact; name matches slug |
| 114 | person:john-5 | John | a | Prefix artifact; name matches slug |
| 115 | person:jonah-1 | Jonah | a | Prefix artifact; name matches slug |
| 116 | person:josh-1 | Josh | a | Prefix artifact; name matches slug (Morm 6:14) |
| 117 | person:jude-1 | Jude | a | Prefix artifact; name matches slug |
| 118 | person:luke-1 | Luke | a | Prefix artifact; name matches slug |
| 119 | person:mark-1 | Marcus | a | Col 4:10 KJV "Marcus" = Mark; descr (nephew of Barnabas) confirms |
| 120 | person:micah-1 | Micah | a | Prefix artifact; name matches slug |
| 121 | person:micah-2 | Micah | a | Prefix artifact; name matches slug |
| 122 | person:micah-3 | Micah | a | Prefix artifact; name matches slug |
| 123 | person:micah-4 | Micah | a | Prefix artifact; name matches slug |
| 124 | person:moroni-1 | Moroni | a | Prefix artifact; name matches slug |
| 125 | person:moroni-2 | Moroni | a | Prefix artifact; name matches slug |
| 126 | person:moses-1 | Moses | a | Prefix artifact; name matches slug |
| 127 | person:mosiah-1 | Mosiah | a | Prefix artifact; name matches slug |
| 128 | person:mosiah-2 | King Mosiah | a | Prefix artifact + royal epithet; descr confirms |
| 129 | person:nahum-1 | Nahum | a | Prefix artifact; name matches slug |
| 130 | person:nahum-2 | Nahum | a | Prefix artifact; name matches slug |
| 131 | person:omni-1 | Omni | a | Prefix artifact; name matches slug |
| 132 | person:philip-1 | Philip | a | Prefix artifact; name matches slug |
| 133 | person:philip-2 | Philip | a | Prefix artifact; name matches slug |
| 134 | person:philip-3 | Philip | a | Prefix artifact; name matches slug |
| 135 | person:ruth-1 | Ruth | a | Prefix artifact; name matches slug |
| 136 | person:titus-1 | Titus | a | Prefix artifact; name matches slug |
| 137 | peters-house | Peter's House | a | Apostrophe tokenization |
| 138 | pharaohs-daughter-1 | Pharaoh's Daughter | a | Apostrophe tokenization |
| 139 | pharez-1 | Phares | a | KJV NT spelling (Matt 1:3 / Luke 3:33) |
| 140 | pilates-wife-1 | Pilate's Wife | a | Apostrophe tokenization |
| 141 | place-accad-1 | Accad | a | Prefix artifact; name matches slug |
| 142 | place-admah-1 | Admah | a | Prefix artifact; name matches slug |
| 143 | place-ai-1 | Ai | a | Prefix artifact; name matches slug |
| 144 | place-allon-bacuth-1 | Allon-bacuth | a | Prefix artifact; name matches slug |
| 145 | place-ararat-1 | Ararat | a | Prefix artifact; name matches slug |
| 146 | place-ashteroth-karnaim-1 | Ashteroth-karnaim | a | Prefix artifact; name matches slug |
| 147 | place-assyria-1 | Assyria | a | Prefix artifact; name matches slug |
| 148 | place-atad-1 | Atad | a | Prefix artifact; name matches slug |
| 149 | place-avith-1 | Avith | a | Prefix artifact; name matches slug |
| 150 | place-babel-1 | Babel | a | Prefix artifact; name matches slug |
| 151 | place-beer-lahai-roi-1 | Beer-lahai-roi | a | Prefix artifact; name matches slug |
| 152 | place-beersheba-1 | Beersheba | a | Prefix artifact; name matches slug |
| 153 | place-bered-1 | Bered | a | Prefix artifact; name matches slug |
| 154 | place-bethel-1 | Bethel | a | Prefix artifact; name matches slug (dup vs row 8 `bethel` — see Observations) |
| 155 | place-bethlehem-1 | Ephrath | a | Gen 35:19 "Ephrath, which is Beth-lehem" — explicit in-text equation, same place |
| 156 | place-bozrah-1 | Bozrah | a | Prefix artifact; name matches slug |
| 157 | place-calah-1 | Calah | a | Prefix artifact; name matches slug |
| 158 | place-calneh-1 | Calneh | a | Prefix artifact; name matches slug |
| 159 | place-canaan-1 | Canaan | a | Prefix artifact; name matches slug |
| 160 | place-chaldea-1 | Chaldea | a | Prefix artifact; name matches slug |
| 161 | place-chezib-1 | Chezib | a | Prefix artifact; name matches slug |
| 162 | place-cush-1 | Cush | a | Prefix artifact; name matches slug |
| 163 | place-damascus-1 | Damascus | a | Prefix artifact; name matches slug |
| 164 | place-dan-1 | Dan | a | Prefix artifact; name matches slug |
| 165 | place-dinhabah-1 | Dinhabah | a | Prefix artifact; name matches slug |
| 166 | place-dothan-1 | Dothan | a | Prefix artifact; name matches slug |
| 167 | place-earth-1 | Earth | a | Prefix artifact; name matches slug |
| 168 | place-earth-2 | dry land | b | Gen 1:10 "God called the dry land Earth" — name is the pre-naming description of the same referent |
| 169 | place-eden-1 | Eden | a | Prefix artifact; name matches slug |
| 170 | place-edom-1 | Edom | a | Prefix artifact; name matches slug |
| 171 | place-egypt-1 | Egypt | a | Prefix artifact; name matches slug |
| 172 | place-el-bethel-1 | El-bethel | a | Prefix artifact; name matches slug |
| 173 | place-el-paran-1 | El-paran | a | Prefix artifact; name matches slug |
| 174 | place-elam-1 | Elam | a | Prefix artifact; name matches slug |
| 175 | place-enaim-1 | Enaim | a | Prefix artifact; name matches slug |
| 176 | place-enoch-1 | Enoch | a | Prefix artifact; the city Enoch (Gen 4:17); name matches slug |
| 177 | place-erech-1 | Erech | a | Prefix artifact; name matches slug |
| 178 | place-esek-1 | Esek | a | Prefix artifact; name matches slug |
| 179 | place-etham-1 | Etham | a | Prefix artifact; name matches slug |
| 180 | place-euphrates-1 | Euphrates | a | Prefix artifact; name matches slug (descr notes "the River" usage) |
| 181 | place-gaza-1 | Gaza | a | Prefix artifact; name matches slug |
| 182 | place-gerar-1 | Gerar | a | Prefix artifact; name matches slug |
| 183 | place-gihon-1 | Gihon | a | Prefix artifact; name matches slug |
| 184 | place-gilead-1 | Gilead | a | Prefix artifact; name matches slug |
| 185 | place-gomorrah-1 | Gomorrah | a | Prefix artifact; name matches slug |
| 186 | place-goshen-1 | Goshen | a | Prefix artifact; name matches slug |
| 187 | place-ham-1 | Ham | a | Prefix artifact; the place Ham (Gen 14:5); name matches slug |
| 188 | place-haran-1 | Haran | a | Prefix artifact; name matches slug |
| 189 | place-havilah-1 | Havilah | a | Prefix artifact; name matches slug |
| 190 | place-havilah-2 | Havilah | a | Prefix artifact; properly-numbered second Havilah |
| 191 | place-hazazon-tamar-1 | Hazazon-tamar | a | Prefix artifact; name matches slug |
| 192 | place-heaven-1 | heaven | a | Prefix artifact + case; name matches slug |
| 193 | place-heaven-2 | expanse | b | Gen 1:8 "God called the expanse heaven" — name is the pre-naming description of the same referent (symmetric with place-earth-2, row 168) |
| 194 | place-hebron-1 | Hebron | a | Prefix artifact; name matches slug |
| 195 | place-hobah-1 | Hobah | a | Prefix artifact; name matches slug |
| 196 | place-horeb-1 | Horeb | a | Prefix artifact; name matches slug |
| 197 | place-jabbok-1 | Jabbok | a | Prefix artifact; name matches slug |
| 198 | place-jerusalem-1 | Salem | a | Gen 14:18 Salem, traditionally = Jerusalem (Ps 76:2); id encodes the identification |
| 199 | place-jordan-1 | Jordan | a | Prefix artifact; name matches slug |
| 200 | place-kadesh-1 | En-mishpat | a | Gen 14:7 "En-mishpat, which is Kadesh" — explicit in-text equation |
| 201 | place-king's valley-1 | Valley of Shaveh | a | Gen 14:17 "valley of Shaveh, which is the king's dale" — explicit in-text equation |
| 202 | place-land of the east-1 | Land of the East | a | Prefix artifact; name matches slug |
| 203 | place-lasha-1 | Lasha | a | Prefix artifact; name matches slug |
| 204 | place-machpelah-1 | Machpelah | a | Prefix artifact; name matches slug |
| 205 | place-mahanaim-1 | Mahanaim | a | Prefix artifact; name matches slug |
| 206 | place-mamre-1 | Mamre | a | Prefix artifact; name matches slug |
| 207 | place-masrekah-1 | Masrekah | a | Prefix artifact; name matches slug |
| 208 | place-mesha-1 | Mesha | a | Prefix artifact; name matches slug |
| 209 | place-mesopotamia-1 | Mesopotamia | a | Prefix artifact; name matches slug |
| 210 | place-midian-1 | Midian | a | Prefix artifact; name matches slug |
| 211 | place-migdal eder-1 | Migdal Eder | a | Prefix artifact; name matches slug |
| 212 | place-moab-1 | Moab | a | Prefix artifact; name matches slug |
| 213 | place-moreh-1 | Moreh | a | Prefix artifact; name matches slug |
| 214 | place-moriah-1 | Moriah | a | Prefix artifact; name matches slug |
| 215 | place-mount seir-1 | Mount Seir | a | Prefix artifact; name matches slug |
| 216 | place-na | NA | d | Junk placeholder minted from a curator note, denotes nothing — probe edges (expect 0) then delete |
| 217 | place-nahor-1 | Nahor | a | Prefix artifact; the "city of Nahor" (Gen 24:10); name matches slug |
| 218 | place-negev-1 | Negev | a | Prefix artifact; name matches slug |
| 219 | place-nile-1 | River of Egypt | a | Traditional identification "river of Egypt" = Nile; id encodes it |
| 220 | place-nineveh-1 | Nineveh | a | Prefix artifact; name matches slug |
| 221 | place-nod-1 | Nod | a | Prefix artifact; name matches slug |
| 222 | place-on-1 | On | a | Prefix artifact; name matches slug |
| 223 | place-paddan-aram-1 | Paddan-aram | a | Prefix artifact; name matches slug |
| 224 | place-paran-1 | Paran | a | Prefix artifact; name matches slug |
| 225 | place-pau-1 | Pau | a | Prefix artifact; name matches slug |
| 226 | place-peniel-1 | Peniel | a | Prefix artifact; name matches slug |
| 227 | place-pishon-1 | Pishon | a | Prefix artifact; name matches slug |
| 228 | place-pithom-1 | Pithom | a | Prefix artifact; name matches slug |
| 229 | place-rameses-1 | Rameses | a | Prefix artifact; name matches slug |
| 230 | place-red sea-1 | Red Sea | a | Prefix artifact; name matches slug |
| 231 | place-rehoboth-1 | Rehoboth | a | Prefix artifact; name matches slug (the well, Gen 26:22) |
| 232 | place-rehoboth-2 | Rehoboth | a | Prefix artifact; properly-numbered second Rehoboth (by the river, Gen 36:37) |
| 233 | place-rehoboth-ir-1 | Rehoboth-Ir | a | Prefix artifact; name matches slug |
| 234 | place-resen-1 | Resen | a | Prefix artifact; name matches slug |
| 235 | place-salt sea-1 | Salt Sea | a | Prefix artifact; name matches slug |
| 236 | place-sephar-1 | Sephar | a | Prefix artifact; name matches slug |
| 237 | place-shaveh-kiriathaim-1 | Shaveh-kiriathaim | a | Prefix artifact; name matches slug |
| 238 | place-shechem-1 | Shechem | a | Prefix artifact; name matches slug |
| 239 | place-shiba-1 | Shiba | a | Prefix artifact; NASB "Shiba" / KJV "Shebah" (Gen 26:33); name matches slug |
| 240 | place-shiloh-1 | Shiloh | a | Prefix artifact; name matches slug (see Observations re Gen 49:10) |
| 241 | place-shinar-1 | Shinar | a | Prefix artifact; name matches slug |
| 242 | place-shur-1 | Shur | a | Prefix artifact; name matches slug |
| 243 | place-sidon-1 | Sidon | a | Prefix artifact; name matches slug |
| 244 | place-sitnah-1 | Sitnah | a | Prefix artifact; name matches slug |
| 245 | place-sodom-1 | Sodom | a | Prefix artifact; name matches slug |
| 246 | place-succoth-1 | Succoth | a | Prefix artifact; name matches slug |
| 247 | place-succoth-2 | Succoth | a | Prefix artifact; properly-numbered second Succoth |
| 248 | place-the garden-1 | garden | a | Prefix/article/case tokenization; same referent (garden of Eden) |
| 249 | place-the lord will provide-1 | The LORD Will Provide | a | Gen 22:14 Jehovah-jireh translated; name matches slug |
| 250 | place-tigris-1 | Tigris | a | Hiddekel/Tigris translation variant; name matches slug |
| 251 | place-timnah-1 | Timnah | a | Prefix artifact; name matches slug |
| 252 | place-ur-1 | Ur | a | Prefix artifact; name matches slug |
| 253 | place-valley of hebron-1 | Valley of Hebron | a | Prefix artifact; name matches slug |
| 254 | place-valley of siddim-1 | Valley of Siddim | a | Prefix artifact; name matches slug |
| 255 | place-valley of the jordan-1 | Valley of the Jordan | a | Prefix artifact; name matches slug |
| 256 | place-waters-1 | waters | a | Prefix artifact + case; name matches slug (descr is a curator note) |
| 257 | place-zeboiim-1 | Zeboiim | a | Prefix artifact; name matches slug |
| 258 | place-zoar-1 | Zoar | a | Prefix artifact; name matches slug |
| 259 | place:dan | Dan | a | Namespace-prefix artifact; name matches slug |
| 260 | place:ether | Ether | a | Namespace-prefix artifact; the city Ether (Josh 19:7); name matches slug |
| 261 | potiphars-hill | Potiphar's Hill | a | Apostrophe tokenization (Abr 1:10) |
| 262 | potiphars-prison | Prison of the King's Prisoners | b | Gen 39:20 designation of the same prison; descr confirms |
| 263 | potiphars-wife-1 | Potiphar's Wife | a | Apostrophe tokenization |
| 264 | potters-field | Potter's Field | a | Apostrophe tokenization |
| 265 | potters-house | Potter's House | a | Apostrophe tokenization |
| 266 | promised-land-canaan | Land of Canaan | a | id qualifier; same land; descr confirms |
| 267 | raamses | Rameses | a | KJV variants (Ex 1:11 / Ex 12:37) |
| 268 | rabshakeh-1 | Rab-shakeh | a | Hyphenation |
| 269 | rachels-sepulchre | Rachel's Sepulchre | a | Apostrophe tokenization |
| 270 | rahab-1 | Rachab | a | Matt 1:5 KJV "Rachab" |
| 271 | rehoboam-1 | Roboam | a | Matt 1:7 KJV "Roboam" |
| 272 | reu-1 | Ragau | a | Luke 3:35 KJV "Ragau" |
| 273 | reuel-2 | Priest of Midian | b | Ex 2:16-18 epithet for Reuel; same person (empty descr but the identification is textual) |
| 274 | salah-1 | Sala | a | Luke 3:35 KJV "Sala" |
| 275 | salchah | Salcah | a | KJV variants (Deut 3:10 / Josh 13:11) |
| 276 | salome-1 | Mother of Zebedee's Children | b | Traditional identification (Matt 27:56 ∥ Mark 15:40); descr consistent |
| 277 | samaria-village | Village of the Samaritans | b | Luke 9:52 designation of the same unnamed village |
| 278 | samaritan-mountain | This Mountain (Mount Gerizim) | b | John 4:20 "this mountain" + traditional identification; descr confirms |
| 279 | samaritan-woman-1 | Woman of Samaria | a | Same designation reordered (John 4) |
| 280 | sauls-armourbearer-1 | Saul's Armourbearer | a | Apostrophe tokenization |
| 281 | serug-1 | Saruch | a | Luke 3:35 KJV "Saruch" |
| 282 | seth-1 | Sheth | a | 1 Chr 1:1 KJV "Sheth" |
| 283 | shaaraim | Sharaim | a | KJV variant (Josh 15:36) |
| 284 | shealtiel-1 | Salathiel | a | Luke 3:27 KJV "Salathiel" |
| 285 | shem-1 | Sem | a | Luke 3:36 KJV "Sem" |
| 286 | shiblom-1 | Shiblon | a | Ether spells the same Jaredite king both ways (Ether 1:11-12 / 11:4); descr (son of Com, father of Seth) matches |
| 287 | shimea-1 | Shimma | a | 1 Chr 2:13 KJV "Shimma"; same third son of Jesse; descr confirms |
| 288 | shuah-1 | Shua (daughter of) | d | id = the Canaanite father (Gen 38:2), name = the daughter/wife (1 Chr 2:3); descr internally contradictory — probe anchors/edges, possibly split |
| 289 | sibbechai-1 | Sibbecai | a | KJV variants (2 Sam 21:18 / 1 Chr 27:11) |
| 290 | siseras-mother-1 | Mother of Sisera | a | Same designation reordered (Judg 5:28) |
| 291 | socho | Socoh | a | KJV variants (Josh 15:35) |
| 292 | solomons-porch | Solomon's Porch | a | Apostrophe tokenization |
| 293 | temple-holy-chambers | Holy Chambers of the Priests | a | id qualifier; same chambers (Ezek 42) |
| 294 | temple-inner-court | Inner Court | a | id qualifier; same court (Ezek 44) |
| 295 | temple-mount-jerusalem | Court of the Lord's House | b | Jer 26:2 designation of the same temple court (near-dup of row 66 — see Observations) |
| 296 | temple-outer-court | Outer Court | a | id qualifier; same court |
| 297 | temple-south-gate | South Gate | a | id qualifier; same gate (Ezek 46:9) |
| 298 | terah-1 | Thara | a | Luke 3:34 KJV "Thara" |
| 299 | tertullus-1 | Tertius | c | Descr = Tertius, amanuensis of Romans (Rom 16:22); Tertullus = Paul's prosecutor (Acts 24) — id wrong |
| 300 | the ethiopian eunuch-1 | the eunuch | a | Shortened same designation (Acts 8) |
| 301 | unnamed-kinsman-1 | The Nearer Kinsman | b | Ruth 4 designation of the same unnamed redeemer; descr confirms |
| 302 | unnamed-lord-1 | The King's Lord | b | 2 Kgs 7:2 "the lord on whose hand the king leaned"; descr confirms |
| 303 | valley-of-shittim | Abel-shittim | a | Num 33:49 Abel-shittim ("meadow of the acacias") = the Shittim encampment; same place |
| 304 | witch-of-en-dor-1 | The Woman of En-dor | b | Equivalent descriptive designations of the same woman (1 Sam 28) |
| 305 | yhvh-2 | Father in heaven | d | id (Jehovah) vs name (the Father) may denote distinct divine persons under the corpus's theology — resolve per the ontology's deity-modeling convention |
| 306 | zarah-1 | Zara | a | Matt 1:3 KJV "Zara"; descr confirms twin of Phares |
| 307 | zarthan | Zartanah | a | KJV variants (1 Kgs 7:46 / 1 Kgs 4:12); traditionally the same place |
| 308 | zebedees-wife-1 | Mother of Zebedee's Children | a | Same designation reordered (Matt 27:56) (near-dup of salome-1 — see Observations) |
| 309 | zerubbabel-1 | Zorobabel | a | Luke 3:27 KJV "Zorobabel" |
| 310 | zethar-1 | Zetham | c | Descr = Zetham son of Jehieli (1 Chr 26:22); Zethar = Ahasuerus's chamberlain (Esth 1:10) — id wrong |
| 311 | zoram-2 | Zorobabel | c | Descr = Zerubbabel (Matt 1:13); Zoram = BoM figures — id wrong; zerubbabel-1 exists → merge (or name-correct if edges are Zoram's) |

## Observations out of item-7 scope (for the ratifier, no action here)

- **Duplicate-entity pairs surfaced incidentally**: `bethel` (row 8) vs
  `place-bethel-1` (row 154); `salome-1` (row 276) vs `zebedees-wife-1`
  (row 308) — same woman under standard harmonization; `lords-house-court`
  (row 66) vs `temple-mount-jerusalem` (row 295) — same court. Entity
  dedupe is item-3-adjacent territory, not id↔name triage.
- **Id hygiene**: several ids contain spaces or apostrophes
  (`place-king's valley-1`, `place-migdal eder-1`, `the ethiopian
  eunuch-1`, `place-mount seir-1`, etc.) — cosmetic, but worth folding
  into any future id-normalization pass.
- **`place-shiloh-1`** (Gen 49:10 "until Shiloh come"): arguably a
  messianic title (person), not a place — a typing question, not an
  id↔name conflict.
- **Generic-role id** `king-of-assyria-1` (= Pul): if other Assyrian kings'
  mentions ever link to this id, it becomes a conflation risk; name/descr
  currently consistent.
