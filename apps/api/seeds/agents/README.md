# Agent profiles (seeds)

You can customize the Design Agent here with YAML Profiles. Boot / runtime loads these from disk (not DB rows).

| Path | Role |
|------|------|
| `bindings.yaml` | `product` / `surface` → profile id；`default` 兜底 |
| `profiles/*.yaml` | AgentProfile：stages、roles、subagents、contracts、`$kv` policy |

Resolve order and live graph: **[docs/agent-profile.md](../../../../docs/agent-profile.md)**.

Override active id：`AGENT_PROFILE_ID`（见 `apps/api/.env.example`）。

Shipped profile：`profiles/design.canvas.yaml`（`canvas_ops_v1` + Review fork）。
