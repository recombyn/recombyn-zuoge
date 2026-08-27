# ADR 0021: Open agent-sdk package

- **Status:** Accepted (amended)
- **Date:** 2026-08-14
- **Amended:** 2026-08-27 — session event vocabulary (zuoge Harness)

## Context

The Design Agent Kernel stage names (`intent → decide → paint → observe →
review → settle`) and default contract schema ids were duplicated across
AgentProfile defaults and graph builders. Contributors need one open vocabulary.
Eval / debug also needs a stable **model-lane** event type set that is not
tied to UI reconnect replay.

## Decision

1. Ship `packages/agent-sdk` (`recombyn_agent_sdk`) with:
   - `KERNEL_STAGES`, `KERNEL_CANVAS_REQUIRED`
   - `DEFAULT_CONTRACT_IDS`, `PROFILE_KIND`
   - `is_kernel_stage` / `is_paint_mutating_stage` helpers
   - `SessionEventKind`, `MODEL_TRACE_EVENT_TYPES`, `model_event()` (model trace lane)
2. API AgentProfile + `canvas_ops_v1` builder import these constants.
3. Full LangGraph / SubAgent / tool pipeline runtime stays in the API
   (`runtime/graph/`, `runtime/seams/`, `runtime/session_log.py`). This package
   is the open naming + contract + session-event vocabulary only.
4. Public docs still must not describe proprietary intelligence backends.
5. Design Agent extension seams are documented in [agent-harness.md](../agent-harness.md)
   (zuoge Harness) — fixed Kernel, pluggable Skills / overlays / hooks.

## Consequences

- Stage vocabulary stays single-sourced for tooling and profiles.
- Paint-mutation rule is explicit for pack / profile authors.
- Trace clients and eval harness share one event type enum with the API.

## References

- `packages/agent-sdk`
- `apps/api/app/services/design/runtime/session_log.py`
- `apps/api/app/services/design/runtime/seams/`
- [agent-harness.md](../agent-harness.md)
- [ADR 0017](./0017-intelligence-provider-boundary.md)
- [ADR 0019](./0019-open-skill-sdk.md) · [ADR 0020](./0020-open-plugin-sdk.md)
