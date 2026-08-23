# ADR 0004: One API, domain modules

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Recombyn runs a Python API (auth, projects, wallet, Design Agent, jobs) and a Node collab process. That is the topology.

## Decision

1. **Keep domain folders in `apps/api`** (auth, projects, design, wallet, assets) — one deployable, clear module boundaries.
2. **Keep `apps/collab` as its own process** (WS fanout and token boundary) — see [ADR 0003](./0003-yjs-collab-service.md).
3. **LLM routing is in-process** (provider interface + `get_llm_endpoint` / `build_chat_model`), not a separate gateway.
4. **Async work uses workers that share the API codebase**; split worker images only if deploy/scaling needs diverge.

## Consequences

### Positive

- Matches current team size and OSS self-host story.
- Faster feature delivery; one schema / one migration story.
- Domain boundaries stay explicit via ADR + CODEOWNERS + tests.

### Negative / trade-offs

- A noisy Design Agent can still contend with REST latency until jobs move off-request.
- Must maintain discipline so modules do not become a ball of mud.

## Alternatives considered

1. **Merge collab into the API** — rejected; WS and Python workers couple poorly.

## References

- [Roadmap](../roadmap/platform.md)
- Worker settings already in `apps/api/app/core/config.py`
