# Panel-2 Adversarial Review — Security (tske-cross-references)

| ID | Tag | Rationale (≤ 25 words) |
|---|---|---|
| SEC-1 | risky | Parameterized inserts + in-tx verse-id invariant bound blast radius to well-formed bogus data; pinning/vendoring adds ongoing maintenance for near-zero real impact. |
| SEC-2 | material | Real gap; cheap precedented fix — `align-edge-chapter-ids.mjs` already wraps a full `lumen.edges` delete+update in one `sql.begin` on this exact table. |
| SEC-3 | material | scrub() is a real 5-site pattern; one-line fix prevents plausible DSN leak via PG connection-error messages into logs/CI. |
| SEC-4 | out-of-scope | CC-BY attribution wording is a licensing/legal-compliance question, not a confidentiality/integrity/availability or injection concern — not a security finding. |
| SEC-5 | material | Cheap, precedented (3 sibling scripts) ask to pin the parameterized `jsonb_to_recordset` pattern for untrusted TSV fields, closing off ad hoc string SQL. |

## Overall stance

Panel-1's factual claims check out against the codebase (scrub(), jsonb_to_recordset, the permissive `USING (true)` RLS on `lumen.edges`, and the single-tx precedent in `align-edge-chapter-ids.mjs` are all real), so this isn't a case of hallucinated house patterns. SEC-2, SEC-3, and SEC-5 are legitimate, cheap, precedented fixes worth requiring explicitly in the plan. SEC-1's "high" severity overstates the actual threat model for this project — a manually-invoked, owner-run admin script ingesting public CC-BY data through parameterized inserts with a verse-id invariant gate — so the recommended checksum-pinning machinery costs more ongoing upkeep than the residual risk justifies; downgrade and treat as optional hardening rather than a blocker. SEC-4 is a reasonable licensing-compliance catch but belongs to a legal/content review, not a security one, and should be routed there instead of gating this panel.
