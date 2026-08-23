# ADR 0006: In-process LLM 中台 + memory tiers

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Chat, Design Agent, and BYOK already live in one API. We need a **named contract** so new call sites do not invent parallel routers, without rewriting Design Agent.

## Decision

### LLM 中台 (in-process)

1. **Deployable:** stay inside the FastAPI app — LLM routing is in-process.
2. **Canonical façade** (same module `app.services.llm`):
   - `get_llm_endpoint` → credentials / transport (`LlmEndpoint`)
   - `build_chat_model` → LangChain chat model
   - Modalities keep their modules: `generate_image` / video / audio
3. **Ownership split:**
   - Design Agent owns **which** model (`models_route` + Admin rules).
   - Façade owns **how** to reach the provider (catalog, env keys, BYOK contextvars).
4. HTTP/job paths call the same two functions — no parallel alias layer.

### Memory tiers

Map roadmap “project → session → global” onto what already ships:

| Roadmap | Implementation today |
|---------|----------------------|
| Session | Short-term dialogue + medium `task_state` on chat session; LangGraph thread checkpointer |
| Project | `project_id` on medium / episodes (scoped fields; not a separate store yet) |
| Global (user) | Long-term LangGraph Store + `AgentLongMemory`; episodes / KG by `user_id` |

Strengthening a dedicated project store or vector index is a **later** change inside `agent_memory`, not a new service.

## Consequences

### Positive

- Clear public entry for reviewers / CODEOWNERS without new packages.
- Memory vocabulary matches roadmap without a rewrite.

### Negative / trade-offs

- `llm/__init__.py` stays large; extraction only when 3+ packages need a shared binary.
- Project tier is weak isolation until medium/episode queries enforce it harder.

## Alternatives considered

1. **Move LLM routing out of the API** — not the topology; keep `app.services.llm` (ADR 0004).
2. **Orphan `llm_adapter.py` / `model_gateway/`** — rejected (in-file / same-module rule).
3. **Force all Design nodes through a new Protocol** — rejected; churn without benefit.

## References

- [ADR 0004](./0004-modular-monolith-first.md)
- `apps/api/app/services/llm/__init__.py`
- `apps/api/app/services/agent_memory/service.py`
- [Roadmap Phase 2](../roadmap/platform.md)
