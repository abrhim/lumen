# Example feature brief — fixture for the workflow

Used by the validator + as a worked example for a new contributor.

## Brief

> "Add an endpoint that lets a member place an order on an open event. Each
> order is one row plus N order_lines. Idempotent — duplicate POSTs with the
> same `Idempotency-Key` return the original order. One-order-per-(event,
> buyer) — second POST mutates instead of duplicating."

## Expected initial classification

| Risk axis | Tripped? | Why |
|---|---|---|
| Public surface | yes | New REST endpoint `POST /events/:id/orders` |
| Auth / authz / secrets | yes | Buyer must be authenticated; organizer ≠ buyer authz |
| Data migration | no | `orders` and `order_lines` already exist |
| Money / billing | edge | Touches tier pricing math indirectly via line totals |
| Behavior change | yes | New product behavior |
| Cross-system blast radius | yes | API + DB + (future) MCP `place_order_for_user` |

**Tier**: `large` — multiple risk axes, schema-touching reads, auth-touching, idempotency invariant. (Or arguably `standard` if migration is no-op — but blast radius pushes it up.)

## Expected panel-1 specialists (8 for large)

Mandatory: security, correctness.
By feature type (backend): performance, api-contract, data-integrity, observability.
Two more for large: ux (organizer dashboard implications), reliability.

## Expected harness invariants (preview)

- Happy path: POST creates order + lines; GET /orders/mine returns it.
- Idempotency: same `Idempotency-Key` → same response, no duplicate row.
- Uniqueness: second POST with different items but same buyer+event → 200 with mutated order, single row in DB.
- Authz: organizer cannot place order on behalf via this endpoint (separate `place_order_for_user` MCP tool).
- Closed event: POST returns 409 with stable error code.
- Tier boundaries: when an order's qty crosses a tier threshold, the snapshotted unit price reflects the new tier.

## Expected failure modes section

- Duplicate POST without idempotency key → reject with 400.
- Concurrent POST from same buyer → exactly one row wins (UNIQUE constraint).
- Item from a different event → 400.
- Quantity ≤ 0 → 400.
- Item not in event → 400.
