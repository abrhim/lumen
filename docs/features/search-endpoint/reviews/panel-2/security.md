# Panel-2 — adversarial tags for security

| ID | Tag | Rationale (≤25 words) |
|----|-----|------------------------|
| SEC-1 | risky | Probe confirms unshaken.public=true, but that's the deliberate 2026-07-21 launch (public=false = kill switch). Fix regresses shipped feature; H8 gates via explicit params, not vacuous. |
| SEC-2 | material | Verified live: has_schema_privilege('lumen_read','extensions','USAGE')=false and public-schema function default-ACL omits lumen_read; tier-2 fails permission-denied in prod, masked by degrade-to-empty. |
| SEC-3 | material | Verified: 31,262 jst_reading rows in collection 'jst'; search-harness.test.ts:186 exempts the scripture group, contradicting the plan's own fail-closed invariant (only canon verses). |
| SEC-4 | material | Precedent verified at scripture.tsx:367-368 (SECURITY-3 private,no-store); admin-entitled responses vary by session with no cache directive; one header plus one pin. |
| SEC-5 | material | Confirmed shape-only: H9 (harness lines 192-209, api-search 93-108) asserts only contract shape; decision 2's declared escaping invariant has zero value assertions. |
| SEC-6 | material | Verified: root .env DATABASE_URL is postgres.* admin; loadDsn fallback (lines 21-36) breaks the harness's lumen_read premise and would mask the SEC-2 grant-failure class. |
| SEC-7 | material | Verified: search_index.collection_id is_nullable=YES and strongs_lexicon has no collection column; plan omits NULL semantics, inviting a fail-open OR-IS-NULL clause. |
| SEC-8 | material | Verified live: all sampled episode payloads jsonb_typeof='string' (double-encoded); verbatim return breaks decision-5's payload-object contract, and H13 skips episode-kind payloads. |
| SEC-9 | out-of-scope | Bulk-export concern is abuse hardening, explicitly deferred (plan.md:35); moments carry the same visibility gate, and unshaken transcripts are already public (probe: public=true). |

## Stance

Mostly signal — an unusually strong panel-1: every evidence claim I probed reproduced live (extensions-schema ACL gap, JST harness exemption, double-encoded episode payloads, nullable collection_id, admin-DSN fallback), and seven findings would materially change what ships, with SEC-2/SEC-3/SEC-6 forming a coherent chain where the harness would certify a broken or leaky prod app. Two misfires: SEC-1's remedy would flip the kill switch on the deliberately-public unshaken launch while mislabeling H8's parameter-level gate as vacuous, and SEC-9 re-litigates the plan's explicitly deferred abuse-hardening scope.