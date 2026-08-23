# ADR 0025: Billing Protocol (open) + commercial strategy (host-private)

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Billing must be auditable for self-host and ecosystem adapters while **commercial
policy** (markup, packs, fraud, promotions) stays with the host operator. This
ADR freezes the **Billing Protocol** (contracts + open cost floor), not a full
hosted billing product.

Design Brief stays in `recombyn_protocol.brief` — **never** under `billing/`.

## Decision

### Layout (`packages/protocol/recombyn_protocol/billing/`)

```text
billing/
├── model.py          # ModelIdentitySchema, ModelCapabilitySchema (+ pricing_id)
├── pricing.py        # PricingSchema / Version / Rate + resolve_pricing()
├── usage.py          # ProviderUsageSchema, UsageEventSchema
├── cost.py           # CostBreakdownSchema (micros), TaskCostSchema
├── events.py         # BillingEvent + CreditTransaction + CreditLedger
├── lifecycle.py      # estimate → authorize → execute → settle (capture/release/refund)
├── budget.py         # BudgetSchema, BudgetPolicySchema, BudgetCheckSchema
├── money.py          # MoneySchema, CurrencySchema, micros helpers
├── provider.py       # ProviderSchema, ProviderBillingAdapter
├── task_pricing.py   # TaskPricingSchema (0.1.3+)
├── credit_policy.py  # CreditPolicySchema (0.1.3+)
├── quota.py          # QuotaSchema (0.1.3+)
├── entitlement.py    # EntitlementSchema (0.1.3+)
└── meter.py          # BillingMeterSchema (0.1.3+)
```

Helpers: `packages/billing-sdk` (builders + `estimate_provider_cost`).

### Three price layers (do not collapse)

```text
Provider Price (PricingVersion / rates)
      ↓
Internal Cost (CostBreakdown.internal_cost_micros)
      ↓
Host commercial policy   ← NOT in Public protocol
      ↓
User Credits / Ledger
```

Public must **not** put `user_price` / `credits_per_token` on Model.

### Invariants

1. Settled usage carries `pricing_version_id` (history never rewritten).
2. Task sell unit is `TaskCostSchema` (many UsageEvents).
3. Lifecycle: estimate → authorize → execute → settle (capture / release / refund).
4. Money ledger truth = integer **micros**; Credits = `int`.
5. Protocol pin: `recombyn-protocol` **0.1.3+** (see ADR 0026 for task-centric schemas).

### Open Runtime landing (illustrative)

- Versioned provider price sheets (`pricing_versions`) bound to usage rows
- Wallet estimate / authorize / capture helpers
- Admin-facing pricing version CRUD for **provider** sheets (not host markup)
- Optional remote quote adapter for cloud hosts (credits only on the wire)

## Consequences

- Ecosystem adapters can meter providers without knowing a host’s commercial policy.
- Public docs never publish host markup, list-price strategy, or private service maps.
- See ADR 0026 for task-centric credits.

## Alternatives considered

- Mutable `model.price` — cannot audit history.
- Billing only in a closed admin app — blocks open adapters.
- Float currency as ledger truth — prefer micros.

## References

- `packages/protocol/recombyn_protocol/billing/`
- `packages/billing-sdk`
- [ADR 0001](./0001-monorepo-boundaries.md)
- [ADR 0017](./0017-intelligence-provider-boundary.md)
- [ADR 0024](./0024-protocol-version-cross-repo-ci.md)
- [ADR 0026](./0026-task-centric-billing.md)
