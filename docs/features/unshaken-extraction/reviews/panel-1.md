# Panel-1 — aggregated (unshaken-extraction A2)

Source of truth: per-role files. Verdicts: extraction-quality sound-with-changes · data-integrity not-approved-as-written (F1-F4 amendments) · pipeline-reliability conditional (superseded by Revision 1 except F3/F8 spirit).

data-integrity · F1: A1's live metadata is double-encoded jsonb — every `metadata->>'source'` filter in the plan matches ZERO rows
data-integrity · F2: Verse/chapter id format in plan + harness is wrong — prod is `2-kgs-14-3`, not `2kgs-14-3`
data-integrity · F3: An A1 re-run silently destroys every A2 edge and resets title mentions
data-integrity · F4: Idempotency should scope on the first-class `source` column — which EXISTS (probe refutes the plan's premise)
data-integrity · F5: UPDATE-vs-INSERT split — the classification FETCH is the untested seam; crash-mid-tx is safe, concurrency fails loud
data-integrity · F6: Confidence floor 0.5 — right gate, but store an edge-level rollup and pin artifact-before-floor ordering
data-integrity · F7: rel_type vocab and direction — clean; enforcement is convention-only, so smoke must resolve targets per kind
data-integrity · F8: Fixture truth vs prod — counts right, and implement existence via id sets
llm-extraction-quality · F1: Exact-name prefilter is defeated by ASR spelling variants — the episode's main figure is invisible
llm-extraction-quality · F2: Pass-1 "explicit chapter transitions" misses inline-entered chapters → runs of wrong-but-existing verse ids
llm-extraction-quality · F3: Cross-book tangents — bare verse refs under a stamped 2 Kings context resolve to wrong existing verses
llm-extraction-quality · F4: Model-emitted `t` contradicts the design's seq-anchoring rule; dedupe then operates on the weaker signal
llm-extraction-quality · F5: Verse ranges are unhandled — plan and harness are silent where the design doc names them adversarial
llm-extraction-quality · F6: Eval sample is too small per stratum for the gates it must defend, and principles share a gate with name-matched entities
llm-extraction-quality · F7: Seeded traps must mirror the real failure modes or they validate nothing
llm-extraction-quality · F8: Recall is unmeasured — correctly, for a precision-gated v1 — but the plan never says so
pipeline-reliability · F1 — In-flight batch id is not an artifact: a killed poll resubmits and pays twice
pipeline-reliability · F2 — No retry story for partial results; succeeded chunks aren't persisted raw, so one bad chunk wastes its episode
pipeline-reliability · F3 — Pass 1 and pass 2 cannot share one batch; timeline must be its own artifact with an explicit validity predicate
pipeline-reliability · F4 — Token estimate contradicts the plan's own probe data (~5×); no hard pre-submit cap; max_tokens is the only real runaway ceiling
pipeline-reliability · F5 — Secrets: childEnv and scrubSecrets don't know ANTHROPIC_API_KEY, and yt-dlp still spawns during an extract run
pipeline-reliability · F6 — Polling loop semantics unspecified: interval, wall-clock bound, and the exit-code contract
pipeline-reliability · F7 — SDK/ESM interop: clean as planned; three pitfalls to not introduce
pipeline-reliability · F8 — Checkpoint and --episode scoping have no mechanical enforcement in the runner
