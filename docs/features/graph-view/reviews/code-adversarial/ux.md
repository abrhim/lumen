# CODE-ADVERSARIAL / UX — graph-view implementation review

Adjudicates `docs/features/graph-view/reviews/code-panel/ux.md` against the actual code
(`GraphOverlay.tsx`, `ForceLayout.tsx`, `scripture.tsx`) and, for CUX-1, against
`react-router@7.9.6`'s `Await`/`AwaitErrorBoundary` implementation and React's
transition/Suspense reconciliation semantics.

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| CUX-1 | noise | Refuted: router dispatch uses `startTransition` (chunk-AMVS5XVJ.js:9073); `Await`/`AwaitErrorBoundary` are unkeyed and reused, not remounted. GraphBody state survives. |
| CUX-2 | material | Verified: no invoker ref anywhere in `openGraph`/`graphButton`/`GraphOverlay`; UX-10/A11Y-3 explicitly require one. Real gap, especially mobile Sheet↔overlay swap. |
| CUX-3 | material | Verified: truncation copy (`GraphOverlay.tsx:204`) is static, unconditional on depth; "narrow with a smaller depth" is impossible advice at depth 1. |
| CUX-4 | material | Verified: ring is `strokeWidth={1}` `strokeOpacity={0.35}` in the node's own color (`ForceLayout.tsx:190`) — plausibly low-contrast for a non-hover affordance. |
| CUX-5 | risky | Verified: `filtered` (`GraphOverlay.tsx:122-132`) is a new object per toggle; effect keyed `[vm, positions]` (`ForceLayout.tsx:49-136`) restarts the sim. Real, but incremental `sim.nodes()` rewrite is a nontrivial d3-lifecycle change (drag bindings, cleanup, re-entry) — verify before greenlighting. |
| CUX-6 | material | Verified: `disabled={isPending}` on Layout (`:184`) and View (`:191`) though both are pure client state unrelated to the in-flight fetch. Trivial, safe fix. |
| CUX-7 | noise | Sequence is real (`scripture.tsx:339-342`, `:488`), but the reviewer's own "either keep this... or..." concedes it may be intentional — not an actionable defect. |

## Stance

**CUX-1 is factually wrong and should be dropped, not implemented.** I traced the actual
mechanics rather than reasoning from the surface pattern (`Suspense` + new `Await resolve=`
+ render-prop children):

1. **`GraphOverlay` never unmounts across a recenter/depth nav.** In `scripture.tsx`,
   `pendingGraph` is derived from the pending navigation's own `?graph=` search param
   (`scripture.tsx:318-328`), which `openGraph`/recenter always set, so `effectiveGraphId`
   stays non-null for the whole transition — the `{effectiveGraphId !== null && <Suspense><GraphOverlay/></Suspense>}`
   gate (`scripture.tsx:515-527`) never toggles false. No key is set on `<GraphOverlay>` either,
   so React reuses the same fiber and merely re-renders it with new `entityId`/`depth`/`graph` props.

2. **`Await` itself cannot force a remount.** Reading react-router's implementation
   (`node_modules/.../react-router/dist/development/chunk-AMVS5XVJ.js:9193-9283`): `Await` is
   `AwaitErrorBoundary` (an unkeyed class component) wrapping `ResolveAwait`. When `resolve`
   becomes a new pending promise, `render()` just does `throw promise` — this is the standard
   throw-to-suspend pattern. React catches it at the nearest Suspense boundary and internally
   subscribes to that exact promise to know when to retry; it does not tear down or recreate the
   `AwaitErrorBoundary`/`ResolveAwait` fiber pair. No `key` is ever derived from the promise.

3. **The triggering update is a transition, so the revealed boundary isn't unmounted while
   pending.** react-router's router-state dispatch is wrapped in `React.startTransition`
   (confirmed at chunk-AMVS5XVJ.js:9073, and also :8812/:8900/:8968). Per React's own
   Suspense+transition contract, when an update that causes a *revealed* (already-showing-content)
   Suspense boundary to suspend is itself part of a transition, React keeps the last-committed
   tree on screen and works on the new tree in the background, committing atomically only once
   it can complete without suspending. This is exactly why `GraphBody` independently implements
   its own dim-not-blank overlay (`GraphOverlay.tsx:210-212`, gated on `isPending`) — that
   affordance would be pointless if the component were about to be unmounted anyway.

4. **When the new promise resolves, reconciliation preserves `GraphBody`'s fiber.** The retried
   render produces `<ResolveAwait><GraphBody neighborhood={newData} .../></ResolveAwait>` — same
   component type, same position, no key — so React treats it as an update, not a remount.
   `useState`/`useRef` hooks (`layout`, `view`, `hiddenTypes`, `positionsRef`) are preserved.

5. **Corroboration from the code's own intent:** `ForceLayout` explicitly seeds new simulations
   from `positions.get(n.id)` and writes back into that same `Map` on tick-end/unmount
   (`ForceLayout.tsx:51-57,97,134`), which is exactly UX-9 ("position-seeded depth transitions")
   — a mechanism that only works, and is only meaningful, because `positionsRef` (a `useRef` in
   `GraphBody`) is *not* being reset on every navigation. If CUX-1's remount claim were true,
   UX-9 would already be visibly broken, which it is not.

CUX-1's proposed fix — lifting position map, hidden-types, layout, and view state out of
`GraphBody` into `GraphOverlay`/`scripture.tsx` — targets a problem that does not exist under
the app's actual React 19 + react-router 7 runtime behavior. Implementing it would add
indirection and risk (state now needs explicit reset logic keyed on `entityId` for cases where
you *do* want a fresh view, e.g. recentering onto an unrelated entity) for zero behavioral gain.
Recommend closing CUX-1 as invalid rather than scheduling the refactor.

Everything else in the panel's table checks out against the code as described: CUX-2
through CUX-6 are genuine, verifiably-grounded findings (severities as originally scored look
reasonable), with CUX-5 flagged **risky** only because its recommended fix — mutating a live
d3 simulation's node/link sets in place instead of re-running `forceSimulation()` — is a real
d3-lifecycle change (drag handlers, alpha targets, cleanup ordering) that needs careful
implementation and testing, not because the finding itself is doubtful. CUX-7 is downgraded to
**noise**: the original write-up already hedges that the current behavior may be intentional and
offers "add a comment" as an acceptable resolution, which is not an actionable defect.
