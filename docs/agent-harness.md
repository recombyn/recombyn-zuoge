# zuoge Harness — Design Agent extension seams

Extension surface for the Design Agent **without** replacing LangGraph
`canvas_ops_v1`. Kernel topology stays fixed; packs / overlays / hooks plug in.

## Kernel (fixed)

```
intent → decide → paint → observe → [review] → settle
```

Live driver: `apps/api/app/services/design/runtime/graph/` + AgentProfile
`topology.template: canvas_ops_v1`.

**Boundary:** Kernel = control loop, tool scheduling, canvas R/W, allowlist,
wallet. Skills / design floors = craft. Tools = atomic `tool_ops` on the FE host.

## Extension points

| Seam | Where | Purpose |
|------|--------|---------|
| **Session event log** | `session_log.py` + `GET /design/run/{id}/trace` | Model-lane append-only trace (`turn/*`, `stage/decision`, `llm/*`, `tool/ops_emit`, `scene/feedback`) |
| **Tool pipeline** | `runtime/seams/tool_pipeline.py` | pre-hooks → validate (+ density) → post-hooks; used by paint / apply / review / img_layers |
| **Skill `handler.py`** | opt-in `DESIGN_SKILL_OPS_RUNNER` | Short-circuit paint ops before LLM |
| **Skill `hooks.py`** | `register_pipeline(registry)` | Pack-local pre/post hooks on the shared `HookRegistry` |
| **Profile overlay** | `seeds/agents/overlays/*.patch.yaml` + `agent-overrides/local.patch.yaml` | Deep-merge onto `profiles/{id}.yaml` |
| **Design floors** | `packages/intelligence-client` | In-process **BasicLocal** provider (always) |

## Session lanes

- **UI lane** — reconnect-safe product events (`status`, `activity`, `result`, …). No canvas payloads.
- **Model lane** — eval/debug trace via `/trace`. Same outbox table, filtered by event type.

UI publish path: `event_publisher.publish_design_output` → `session_log.append(..., lane="ui")`.

## Run modes

| `run_mode` | Behavior |
|------------|----------|
| `agent` | Full LangGraph canvas ops |
| `single_model` | Same graph; locked / simplified model routing |

The web client `DesignRunMode` is only `'agent' | 'single_model'`. Do not send other mode strings from FE.

Chat `mode=react` (`stream_official_agent`) is a **separate** conversation loop, not the Design canvas driver.

## Related

See [ADR 0017](./adr/0017-intelligence-provider-boundary.md), [ADR 0021](./adr/0021-open-agent-sdk.md).

## Local profile override

```bash
cp apps/api/agent-overrides/local.patch.yaml.example \
   apps/api/agent-overrides/local.patch.yaml
```

`local.patch.yaml` is gitignored.
