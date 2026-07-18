# unshaken-ingest — code-adversarial review (SECURITY-SECRETS)

Method: line citations re-checked against source; claims re-verified by executing `node`
against the real `util.mjs`/`postgres@3.4.9` modules and inspecting the actual root `.env`
(values not printed). Fixes attacked, not trusted. Calibration: solo-dev, manual runs,
Ctrl-C-prone; the concurrent-runner incident is real (bugs.md:31-33) but operator-initiated
and, per that log, caused a monitor glitch — not artifact corruption or double-billing.

| ID | Tag | Rationale (≤25 words, evidence file:line or executed repro) |
|----|-----|-------------------------------------------------------------|
| CSEC-1 | risky | Race real, but skip-if-valid dedups; the one concurrent incident (bugs.md:31-33) corrupted nothing; mkdir-lock fix = stale-lock deadlock on Ctrl-C-prone manual runs, worse than the race. |
| CSEC-2 | noise | Repro: `postgres(bad-dsn)` throws "Invalid URL" (no password), `readFileSync`→ENOENT — no secret leaks outside try; real async errors hit inside, scrubbed. Proposed move-into-try double-throws on undefined `sql.end` (repro'd). |
| CSEC-3 | risky | Dead fallback confirmed: nothing sets `process.env.DEEPGRAM_API_KEY` (grep), so util.mjs:12 never fires. But key only formats as `Token ${apiKey}`, already scrubbed (repro'd); fix-(b) regresses closed 47bf9d2. |
| CSEC-4 | risky | Same race; double-bill real but narrow-window, Deepgram on $200 credit, no incident harm. Non-atomic write self-heals: truncated JSON→parse-throw→stale→re-transcribe. temp+rename sound; lock shares CSEC-1 stale-lock footgun. |
| CSEC-5 | noise | Repro confirms quotes/comments retained, but real `.env` is unquoted/uncommented (checked)→inert; and not silent — quoted DSN→`postgres()` "Invalid URL" fail-fast (repro'd), quoted key→Deepgram 401. CRLF trimmed. |

**Overall stance.** The panel located every defect precisely (all line citations accurate),
but over-rated their consequences for this solo-dev, fail-closed pipeline: both secret-leak
claims collapse under execution — the malformed-DSN throw carries no password ("Invalid URL"),
and the key only ever appears in the `Token`-prefixed form the live regex already scrubs, so
CSEC-2/CSEC-3 produce no reachable leak, and CSEC-5's "silent corruption" actually fails loud on
the clean current `.env`. The genuine residuals are the two concurrency races (CSEC-1/CSEC-4),
which are real but narrow, recoverable, and un-demonstrated by the one operator-initiated
incident — and, decisively, the panel's headline fixes are unsafe as written: the mkdir-lock
invites a stale-lock deadlock on a Ctrl-C-prone manual pipeline, the "move into try" double-throws
on an undefined `sql` handle, and CSEC-3's env-set option regresses closed bug 47bf9d2. Net: nothing
here should block the branch; apply only the crash-safe per-episode temp+rename (fetch and transcribe)
and the explicit `extraSecrets:[apiKey]` pass, and skip the locks and the env-var.
