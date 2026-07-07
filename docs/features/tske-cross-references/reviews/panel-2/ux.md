# Panel-2 (adversarial) / ux review — tske-cross-references

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| UX-1 | material | Real: cross-refs go critical-path, principles/people stay Neo4j-streamed, but chips sit *above* refs in DOM — pop-in shifts already-rendered cards. "One payload" fix option violates plan's own COR-2 rule. |
| UX-2 | material | Real disclosure gap (Q5 caps 20/direction, no total shown); panel-1's "count query already available" is false but a `COUNT(*) OVER()` addition is cheap, so worth fixing. |
| UX-3 | material | Plan text literally invites this ("panels to weigh in" on range dedup); current single-verse highlight architecture can't span a range, so at minimum the title-disclosure fix is warranted. |
| UX-4 | material | Q6 is an explicitly open question the plan wants resolved; "Curated" is a low-cost, defensible alternative even though the sole reader is the developer who chose "legacy." |
| UX-5 | material | Genuine gap: one generic empty-state string conflates "Bible verse, no OpenBible refs" (rare/suspicious) with "BoM verse, no legacy refs" (expected); not covered by any of the 10 failure modes; cheap conditional-copy fix. |
| UX-6 | material | Public contract commits to a CC-BY footer credit below up to 40 scrollable cards — genuinely easy to miss; moving the line under the section headers is a few-line change. |
| UX-7 | noise | Premise is wrong: plan's Scope §4 explicitly spells out "References"/"Referenced by" as the new labels — it *is* documented, just not justified. Direction-clarity worry is unsubstantiated bikeshedding for a one-user app. |

## Overall stance

Panel-1's UX read holds up well against the actual plan text and `scripture.tsx`: six of seven findings point at concrete, plan-grounded gaps (an architectural timing split that isn't reconciled with DOM order and the house "no layout shift" rule, an unaddressed truncation/empty-state/attribution disclosure trio, and a genuinely open wording question) with fixes cheap enough to justify flagging even for a one-user app. UX-1 deserves a caveat rather than a downgrade: its "reserve fixed-height slots" fix is sound, but its "one resolved payload" alternative directly contradicts the plan's own COR-2 constraint (PG must never be touched from a deferred promise), so only half of its prescribed fix is actually usable. UX-7 is the one finding that doesn't survive scrutiny — it asserts the rename is "undocumented as intentional" when the plan's Scope §4 states the new labels outright, and its directional-clarity concern is speculative wordsmithing with no user (beyond the developer) to confuse.
