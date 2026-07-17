| ID | Tag | Rationale (≤25 words, with evidence file:line where you verified/refuted) |
|----|-----|--------------------------------------------------------------------------|
| SEC-1 | material | Verified: plan.md:134 H9 promises "scrub on all fatals," but test.mjs:142-147 only checks request-shape (key-not-in-argv). No stage error-path scrub test exists. |
| SEC-2 | material | Verified: migrate-user-roles.mjs:24-26 + ingest-words.mjs:30-31 redact DSN/`password=` only, no bearer-token regex — reused scrub is blind to DEEPGRAM_API_KEY. `Token \S+` fix safe. |
| SEC-3 | risky | Node env-inheritance is real, but NO sibling child_process exists (grep: only regex `.exec`). PATH-only env is the task's own HOME/TMPDIR-breaking overcorrection — breaks yt-dlp. |
| SEC-4 | material | Verified: test.mjs:250-254 asserts append/guard/no-replace but nothing pins `WHERE slug='admin'`; the guard regex `@>` needn't scope. Unscoped UPDATE over-grants every role. |
| SEC-5 | material | Verified gap: test.mjs:127-133 pins URL/bestaudio, not the 11-char id-regex nor argv-vs-shell. Array return (test:129) + trusted discover id mitigate; modest but cheap. |
| SEC-6 | noise | Mechanism refuted: Deepgram response body carries no key; plan.md:72 writes validated utterances only, gitignored+local. Speculative raw-error-object leak already precluded by H5 validate-before-write. |
| SEC-7 | material | Verified end-to-end: plan.md:109-110 adds key, Files-touched:92-101 omits entitlements-keys.ts; grant-role.mjs:57 decideRole then refuses admin grants (keys.ts:8=`['admin.users']`). Strongest finding. |
| SEC-8 | noise | yt-dlp absent everywhere (grep); design risk-5 (media-collections.md:125) already fences brittleness via staged/cached pipeline. Pinning a manual solo-run script is low-value, arguably counterproductive. |

Mostly signal. The harness genuinely under-verifies the plan's own H9 secret-scrub promise (SEC-1/2) and never pins the admin-scoped grant (SEC-4), and SEC-7 is a real internal-consistency bug — a partial land bricks `grant-role.mjs` via `decideRole`'s unknown-key refusal. SEC-3's concern is valid but its PATH-only-env fix is the classic yt-dlp-breaking overcorrection (needs a curated env that keeps HOME/TMPDIR, not PATH-only); SEC-6/8 are low-value hardening for a solo, manually-run, gitignored-artifact pipeline.
