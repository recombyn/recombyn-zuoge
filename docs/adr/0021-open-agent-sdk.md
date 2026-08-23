# ADR 0021: Open agent-sdk package

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The Design Agent Kernel stage names (`intent → decide → paint → observe →
review → settle`) and default contract schema ids were duplicated across
AgentProfile defaults and graph builders. Contributors need one open vocabulary.

## Decision

1. Ship `packages/agent-sdk` (`recombyn_agent_sdk`) with:
   - `KERNEL_STAGES`, `KERNEL_CANVAS_REQUIRED`
   - `DEFAULT_CONTRACT_IDS`, `PROFILE_KIND`
   - `is_kernel_stage` / `is_paint_mutating_stage` helpers
2. API AgentProfile + `canvas_ops_v1` builder import these constants.
3. Full LangGraph / SubAgent runtime stays in the API; this package is the
   open naming + contract map surface only.
4. Public docs still must not describe proprietary intelligence backends.

## Consequences

- Stage vocabulary stays single-sourced for tooling and profiles.
- Paint-mutation rule is explicit for pack / profile authors.

## References

- `packages/agent-sdk`
- [ADR 0017](./0017-intelligence-provider-boundary.md)
- [ADR 0019](./0019-open-skill-sdk.md) · [ADR 0020](./0020-open-plugin-sdk.md)
