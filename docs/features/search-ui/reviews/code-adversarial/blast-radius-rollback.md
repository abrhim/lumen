# Code-adversarial — blast-radius-rollback (search-ui)

Adversarial pass over the blast-radius-rollback code-panel findings. Each row tagged
exactly once. Refutations verified at file:line and/or via live GET-only probe.

| ID | Tag | Rationale |
|----|-----|-----------|
| BRRC-1 | material | Verified: React class error boundaries do not render their fallback for an SSR shell throw (`renderToReadableStream` rejects; getDerivedStateFromError is client-only). SearchModal SSRs on every page (probed: homepage carries `data-slot="dialog-trigger"`), so a deterministic SSR render throw defeats the ratified BRRU-3 "degraded orb, still a door" guarantee — the fallback never reaches the server document. In-lens (SearchChromeBoundary degradation), fix (client-only mount / Suspense) is safe. |
| BRRC-2 | material | Verified live: `GET /search/` → 200, no redirect, page renders while the modal orb also SSRs. `useLocation().pathname` on that URL is `/search/`, so `onSearchPage = pathname === "/search"` (SearchModal.tsx:35) is false and the modal keydown effect stays active alongside the page's (search.tsx:698-723). `/` or ⌘K then opens the Dialog stacked over the page — the exact F9 violation the stand-down prevents. Reachable URL, real defect; B-U2's proxy-vs-source mode. |
| BRRC-3 | material | Verified by trace: on a route ErrorBoundary render (search.tsx:1119) the page hotkey effect unmounts, while SearchModal (root.tsx:104-106) still stands down because pathname is "/search" — so `/`/⌘K are dead on the errored page. Real recovery-path gap in the reviewer's lens; the "Start a new search" link does recover, and no fix regression (render the input in the boundary / context flag). Low value but a genuine verified gap, not style/restating. |
| BRRC-4 | material | Verified residual of the B-U1 mode (bugs.md explicitly asks for B-U1 scrutiny). `onPointerDown` sets `openedByPointer=true` (SearchModal.tsx:80-82); only hotkey opens (43,58) and close (117,138) clear it. A cancelled pointerdown (drag-off, no click, Dialog never opens) leaves the flag stale-true; a later Tab+Enter keyboard open then hits `preventDefault()+blur()` on close, dropping the AU-3 return-focus keyboard opens are ratified to keep. Reachable, real, safe fix. |
| BRRC-5 | noise | Self-described "harmless today": `SearchLoaderData.headers` is a `Headers` husk client-side (live `/search.data?q=grace` serializes it as `["SingleFetchClassInstance", …]` without error). Verified no client consumer — SearchPage destructures without `.headers` (search.tsx:564-565), meta reads only `data?.q`, ErrorBoundary gets no loaderData. Latent contract wart / cleanup, no shipped-quality change. Not a defect. |

## Stance

I largely uphold the specialist. Four of five findings are real, verified defects or
guarantee-gaps within the blast-radius/recovery lens, none introduced by a risky fix, none
out-of-scope:

- **BRRC-1** rests on well-established React streaming-SSR semantics (a class boundary
  cannot catch a shell-render throw; the specialist reproduced it directly). Regardless of
  whether the exact server outcome is "root Oops on every route" or a Suspense fallback +
  client recovery, the SSR path of the ratified BRRU-3 degraded-orb guarantee provably does
  not hold. Material.
- **BRRC-2** I independently confirmed live: `/search/` is a 200 page, the stand-down is
  string equality against a trailing-slash-tolerant route match, so the modal stacks on the
  page — a reachable F9 violation of the same proxy-vs-source class as B-U2.
- **BRRC-3** and **BRRC-4** are accurate low-severity gaps: a hotkey deadzone on the /search
  error boundary (working link recovery), and a stale-`openedByPointer` residual of the B-U1
  fix that drops keyboard return-focus after a cancelled pointer gesture. Both verified by
  code trace; the task treats residual instances of an already-fixed mode as material.
- **BRRC-5** is the one downgrade: the specialist itself flags it "harmless today," and I
  confirmed no client code reads `loaderData.headers`. A serialized `Headers` husk that no
  consumer touches and that serializes without error is a cleanup, not a shipped defect —
  noise.

Skeptical checks that did NOT overturn anything: the specialist's BRRC-1 node repro tests
raw React rather than the real RR tree, so the precise "every route's document" blast radius
is slightly under-verified — but the guarantee gap it proves is real either way, so the tag
stands. The "Verified clean" sweeps (rollback skew, routes.ts ordering, kill-switch
re-gating, F17 error-branch headers, B-U2 residual sweep, cursor 400 contract) are
consistent with the code and were not challenged.
