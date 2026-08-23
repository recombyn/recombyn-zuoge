# ADR 0026: Task-centric billing (credits ≠ tokens)

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

ADR 0025 landed an open Billing Protocol with PricingVersion, UsageEvent,
CostBreakdown, and estimate→reserve→settle. The first Runtime mapping
(`TOKENS_PER_CREDIT = 15_000`) still behaves like a **chat tool**. Recombyn is
an AI Design OS: one task spans research, strategy, candidates, image gen,
review, memory, storage, and orchestration.

Credit must mean **AI work value**, not a token counter.

## Decision

### Public additions (`recombyn_protocol.billing`)

| Schema | Role |
|--------|------|
| `TaskPricingSchema` + `TaskStepPricingSchema` | Product pipeline price sheet (base + steps) |
| `CreditPolicySchema` | Public credit unit + BYOK agent fee (no host markup fields) |
| `QuotaSchema` | Windowed allowances |
| `EntitlementSchema` | Plan grants (credits + quotas + features) — portable shape only |
| `BillingMeterSchema` | What Runtime may count (`llm.*`, `image.gen`, `agent.*`, …) |

Helpers: `credits_from_sell_cost_micros(sell_cost_micros, credit_value_micros=…)`,
`default_oss_task_pricing_catalog()`.

### OSS authorize floors (`default_oss_task_pricing_catalog`)

Runtime and host quote adapters share this public catalog so authorize ceilings
stay aligned. Hosts may override via rules (`billing.task_pricing_json`); the
table below is the **open floor**, not a host list price.

| Pipeline key | `base_credit` | Steps (credits) | High estimate |
|--------------|---------------|-----------------|---------------|
| `agent` | 20 | research 3 + paint 5 + review 2 | 30 |
| `single_model` | 20 | — | 20 |
| `partial` | 10 | — | 10 |
| `image` | 2 | — | 2 |
| `chat` | 1 | — | 1 |

Lifecycle (`BILLING_LIFECYCLE_STAGES`):

```text
estimate → authorize → execute → settle
                                 ├── capture
                                 ├── release
                                 └── refund
```

`CostBreakdownSchema` may include agent/research/eval/gpu/concurrency micros
fields so hosts can audit platform cost components without collapsing them into
token SKUs.

### Public vs host-specific

**In protocol / open Runtime**

- TaskPricing authorize bands
- CreditPolicy (credit value, BYOK agent fee, rounding)
- Wallet / ledger / estimate→authorize→capture
- Optional remote **quote** adapter: host returns `credits_to_charge` only

**Out of protocol (host commercial policy — not documented here)**

- How a host derives sell price from internal cost
- Dynamic pricing, promotions, discounts, list SKUs
- Private analytics / user-value models

Self-host default: TaskPricing + CreditPolicy floor. Cloud hosts may supply a
quote endpoint; open Runtime never requires proprietary pricing code.

### What is no longer product truth

Using `15000 tokens = 1 credit` as the **primary** user SKU. Token meters remain
valid usage inputs; they are not the Design Agent sell unit.

## Consequences

- Runtime estimates/authorizes from `TaskPricingSchema` (+ meters), not token÷15000 alone.
- Protocol pin: **0.1.3+**.
- Capture prefers an optional host quote (`credits_to_charge`); otherwise OSS
  TaskPricing / BYOK agent fee.
- `default_oss_task_pricing_catalog()` is the shared authorize floor
  (`packages/protocol/recombyn_protocol/billing/task_pricing.py`).
- Public docs and ADRs do not describe host markup formulas or private services.

## References

- [ADR 0025](./0025-billing-protocol.md)
- `packages/protocol/recombyn_protocol/billing/task_pricing.py`
- `packages/protocol/recombyn_protocol/billing/credit_policy.py`
