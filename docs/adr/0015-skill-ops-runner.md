# Extensibility — Skill ops runner (Phase C)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Skill packs (ADR 0013) are playbooks: the LLM Paint stage emits `tool_ops`. Authors also want an optional deterministic `handler.py` that returns the same ops shape without inventing a second canvas writer.

## Decision

1. **Opt-in runner** (`DESIGN_SKILL_OPS_RUNNER`, default off). When on, Paint tries a pack `handler.py` **before** the LLM structured call.
2. **Contract:** `def run(ctx: dict, payload: dict) -> list[dict]` only. Return value must be a list of op dicts.
3. **Isolation:** subprocess + JSON stdin/stdout + timeout (`DESIGN_SKILL_OPS_RUNNER_TIMEOUT_SEC`). Bad handlers do not crash the API worker.
4. **Trust boundary:** only `handler.py` under known pack roots (`skills/foundation`, `skills/domains`, `plugins/skills`, `DESIGN_SKILLS_PLUGIN_DIRS`). No Admin-zip / remote code in this phase.
5. **Always re-validate** via existing `validate_ops` (preferred_tools / output_schema / canvas contract). Empty or invalid ops → fall through to LLM paint.
6. **Sample:** `plugins/skills/festival_poster/handler.py`.

## Consequences

### Positive

- Deterministic layouts for self-host packs without waiting on the LLM.
- Same apply/SSE path as Paint (`action` node).

### Negative / trade-offs

- Still not a full sandbox (subprocess shares host Python env).
- Authors must keep handlers aligned with `preferred_tools`.

## Alternatives considered

1. **In-process importlib only** — simpler, weaker isolation.
2. **Replace LLM paint entirely when handler exists** — too brittle when handler returns empty; fallthrough is safer.

## References

- [docs/skill-extensions.md](../skill-extensions.md)
- `app/services/design/prompts/skill_store/ops_runner.py`
- [ADR 0013](./0013-skill-extensions.md)
