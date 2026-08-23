# Recombyn Protocol (Apache-2.0)

Stable **open** contracts for Design Runtime and `intelligence-client`.

**Current pin:** `0.1.3` (prefer `>=0.1.3` for task-centric billing schemas).

- Intelligence method names / request field keys
- `remote_result_usable` / `intelligence_wire_methods`
- Design Brief (P0/P1)
- Reference / Research / Strategy / Candidates / Tournament / Swarm /
  Simulation / Counterfactual / Governance / Autonomous
- Observe / Review scores & caps / Judge / Visual Diff / Preference
- Paint tool_ops / DecideTurn / PaintOps envelopes
- VisionScout turn / DesignTransaction (+ phase helpers)
- **Billing Protocol** (`recombyn_protocol.billing`): Model registry identity,
  versioned `PricingRate` sheets, Usage / TaskCost / TaskPricing,
  CreditPolicy / Quota / Entitlement / Meter, Budget Guard,
  BillingEvent / Credit ledger, micros money helpers,
  `default_oss_task_pricing_catalog()` (shared authorize floors)
  — see [ADR 0025](../../docs/adr/0025-billing-protocol.md),
  [ADR 0026](../../docs/adr/0026-task-centric-billing.md)

This package describes **interfaces**. It does not document proprietary
provider implementations, private datasets, closed prompts, host commercial
policy (markup / promotions / list SKUs), or provider API keys.

## Versioning

Bump `packages/protocol/pyproject.toml` `version` on contract changes.

| Change | Bump |
|--------|------|
| New optional field | patch (`0.1.x`) |
| New required method or request key | minor (`0.x.0`) |
| Breaking rename / remove | major (`x.0.0`) |

## Install

```bash
pip install -e ./packages/protocol
# or (after PyPI publish)
pip install "recombyn-protocol>=0.1.3"
```

## CI / publish

- Smoke: `.github/workflows/protocol-contract-smoke.yml`
- Cross-repo: smoke on `main` can `repository_dispatch` private consumers
  (`protocol-changed`) when configured
- Build / PyPI: `.github/workflows/publish-protocol.yml`
  - tag `protocol-v0.1.3` or manual `publish=true` + secret `PYPI_TOKEN`

See [ADR 0024](../../docs/adr/0024-protocol-version-cross-repo-ci.md).
