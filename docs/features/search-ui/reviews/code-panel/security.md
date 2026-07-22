# Code-panel review — security (search-ui)

Reviewer lens: cursor as attack surface (hostile base64url decode, keyset id
parameterization, FNV collision replay), F16 visibility replay, XSS across every
renderer, modal hotkey scope, and headers on the page route's streamed document
responses. Diff `f352bae..46d888d`; probed LIVE prod (read-only) at
`https://lumen.abramhimmer.workers.dev` (deployed worker fd093ed4 == this diff).

## Verdict on the ratified surface (no findings — held up)

- **Keyset SQL is parameterized.** `keysetAfter` (search.ts:344) passes
  `tier/sub/score/id` as drizzle `sql` params; the decoded `id` string is never
  interpolated. Forged `id` containing `|` round-trips and is compared safely.
- **Hostile cursor decode is robust.** `atob` failure, NUL bytes, over-length,
  huge tier, prototype-ish ids → all 400 `cursor_invalid`/`cursor_scope`, never
  500, raw value never echoed (verified live, below).
- **FNV-32 collision replay is not security-material** (ratified Q1/SU-1/SU-2):
  the hash is binding not integrity, there is no server secret, and visibility is
  re-derived per request — a forged/colliding cursor can only re-paginate the
  requester's own visible set.
- **F16 visibility re-gate holds.** `paged()` wraps the collection-gated `inner`
  in the keyset WHERE, so a cursor minted wide and replayed narrow returns fewer
  rows, silently, no distinct error (harness F16 + reasoning).
- **XSS: clean.** `MarkedText`/`parseMarks` emit JSX text + `<mark>` only (no
  `dangerouslySetInnerHTML` in the results renderer); DB titles/snippets/reference
  displays render as React-escaped text; every `resultHref` is an absolute `/…`
  path (no `javascript:` reachable); `meta()` title escapes `q`.
- **Cache-Control on the streamed document is correct on every branch** (live:
  200, empty, 400 all carry `private, no-store`). B-U2 fix holds
  (`isShortCircuitReference` gates verse/chapter only; groups render for
  book/volume). B-U1 pointer path holds.

## Findings

| ID | Severity | Where | Problem | Fix |
|----|----------|-------|---------|-----|
| SC-1 | high | search.tsx:234, 251-272 (vs api.search.tsx:103-139) | `/search` loader reads `getSessionUser` but discards `session.headers`; returns a plain object + static `headers()` export. On client-nav `.data` requests RR does not revalidate the root loader (the D5 single commit site), so a mid-flight token-rotation `Set-Cookie` is dropped — silently killing the session per the auth layer's own D5 doctrine. | Return `data({…},{ headers: session.headers })` and forward `loaderHeaders` in `headers()`, exactly as `api.search.tsx` already does on both success and 500. |
| SC-2 | med | search.tsx:246, 251-260 (vs api.search.tsx:132-136) | Loader returns the whole `SearchResponse` incl. `meta`. The SSR hydration payload embeds `perGroup/mode/totalMs` always, and under a combined-statement/poisoned-row failure the raw `combinedError` / per-group `error` exception strings — unlike the API route, which returns only `{query, reference, groups}`. | Return only `{ query, reference, groups }` (or strip `results.meta`) from the page loader so DB error strings never reach the client. |
| SC-3 | low | search.ts:222-247 (decode), 344-347 (keysetAfter) | `decodeSearchCursor` accepts NaN/±Infinity `score` bits (regex checks 16 hex, not finiteness). SQL `score < 'NaN'` (NaN sorts highest in PG) returns the partition from the top, so a tampered cursor repeats page-1 with a fresh `nextCursor` — an unbounded self-loop. Self-inflicted only; visibility still re-gated. | In `decodeSearchCursor`, `if (!Number.isFinite(score)) throw new SearchCursorError('cursor_invalid')`. |
| SC-4 | low | SearchModal.tsx:106-139 (`onCloseAutoFocus`); orb persists in root on `/search` | B-U1-mode residual via the keyboard path: a keyboard-opened modal that submits and `navigate()`s to `/search` returns focus (no `preventDefault` for keyboard opens) to the persistent orb; Space then activates the still-live `DialogTrigger` and reopens the modal on `/search` — F9 says the modal never stacks there. Plausible; not browser-verified (no automation in repo). | On `/search`, disable the orb/`DialogTrigger` (or blur it after a hotkey/submit-driven navigation), then verify in a browser. |

## Evidence

### Cache-Control present on every document + API branch (SC-1 is Set-Cookie, not Cache-Control)
```
GET /search?q=faith            -> HTTP 200  cache-control: private, no-store
GET /search  (empty)           -> HTTP 200  cache-control: private, no-store
GET /search?q=faith&scope=bogus-> HTTP 400  cache-control: private, no-store
GET /api/search?q=faith&scope=scripture -> 200  cache-control: private, no-store
```
So the static `headers()` export IS applied to the streamed document — Cache-Control
is fine. What the page loader drops is the session-rotation `Set-Cookie`
(`session.headers`), which it never reads. `root.tsx:31` is the D5 "SINGLE
auth-read site" and commits it via `data({ user }, { headers })`; but RR single-fetch
does not revalidate the unchanged root loader on a client-side navigation to
`/search`, so for those `.data` requests the search loader is the only committer —
and it drops the header. `api.search.tsx` (comment at :98-102) deliberately keeps
`headers` reachable "so session-rotation Set-Cookie survives on both paths"; the
page loader was not given the same treatment.

### SC-2 — internal meta leaks into the SSR hydration payload
Bare field-name occurrences in the `/search?q=faith&scope=scripture` HTML, and the
raw turbo-stream slice:
```
totalMs: 1   perGroup: 1   mode: 2   hits: 1   meta: 3
...\"perGroup\",{...},\"ms\",\"hits\",25,\"totalMs\",141,\"mode\",\"combined\",\"referenceHref\"...
```
`combinedError` is absent on the happy path but is serialized whenever
`meta.combinedError` / `meta.perGroup[key].error` is populated (DB failure /
poisoned row). The API route strips all of this.

### SC-3 — forged non-finite-score cursors loop page-1 (live, HTTP 200, no 500)
Forged cursors carry a valid `(faith, scripture)` hash `2322a274` (recovered by
decoding a real cursor: `v1|2322a274|3|0|3f9acf7400000000|1-tim-5-12`):
```
after=<NaN score  7ff8000000000000> -> HTTP 200  results:5  first:[gal-3-9,2-cor-5-7]  next:yes
after=<Inf score  7ff0000000000000> -> HTTP 200  results:5  first:[gal-3-9,2-cor-5-7]  next:yes  (== page 1)
after=<tier 1e21>                    -> HTTP 200  results:0  next:no
after=<id "a|b|c">                   -> HTTP 200  results:5  first:[alma-60-26,...]  next:yes  (pipe id round-trips)
```
NaN/Inf return the same top rows as page 1 and still mint a `nextCursor` → a client
following the chain loops. Robustness only — no 500, no cross-user leak.

### Cursor decode / contract robustness (held)
```
after=GARBAGE-not-base64!!            -> 400 {"error":"invalid cursor","code":"cursor_invalid"}
after=<300 X's> (over AFTER_MAX 256)  -> 400 cursor_invalid   (raw never echoed)
after present, no scope               -> 400 cursor_scope
valid cursor replayed as q=hope       -> 400 cursor_mismatch
valid cursor, q=faith, page 2         -> 200  new ids [alma-60-26, dc-136-38, dc-18-19], next:yes
```

### Renderer XSS surface (held)
`grep` of the diff: zero `dangerouslySetInnerHTML` in `search.tsx` /
`SearchModal.tsx` (the only one in the tree is root's theme-boot script). Every
`resultHref` branch (search.tsx:361-386) yields an absolute `/…` path;
`momentHref`/`strongs`/`episode`/default use `encodeURIComponent`. Snippets flow
through `parseMarks` → JSX children, so `⟪⟫` glyphs and any `<`/`>` in DB text are
React-escaped.
