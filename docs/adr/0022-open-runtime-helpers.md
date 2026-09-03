# ADR 0022: Open runtime helpers package

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

Optional remote Intelligence HTTP adapters (if an operator wires one) must share
one request body shape with BasicLocal. Empty remote stubs must not override
BasicLocal (Kernel quality).

## Decision

1. Ship `packages/runtime` (`recombyn_runtime`) with
   `build_intelligence_request` (Runtime → HTTP JSON body).
   Empty / status-less remote bodies are unusable via `remote_result_usable` in
   `packages/protocol` (`recombyn_protocol`) — import that helper from protocol,
   not from runtime.
2. API `RemoteIntelligenceProvider` uses `build_intelligence_request` plus
   protocol `remote_result_usable`, then
   `apply_intelligence_result` (API-local) writes usable payloads into Runtime
   slots so Decide/Settle see the same fields as BasicLocal.
3. LangGraph / Scene apply remain in the API; this package stays thin.
4. Document wire shapes and usable rules in protocol / this package — not
   operator-specific model stacks.

## Consequences

- Remote adapters stay aligned on the same payload contract as BasicLocal.
- Unimplemented remotes safely fall back to BasicLocal.

## References

- `packages/runtime`
- `packages/intelligence-client`
- [ADR 0017](./0017-intelligence-provider-boundary.md)
- [ADR 0021](./0021-open-agent-sdk.md)
