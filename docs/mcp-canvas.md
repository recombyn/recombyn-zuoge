# MCP canvas control

zuoge exposes a **Model Context Protocol** server so external AI clients (Codex, Claude Desktop, custom agents) can inspect and edit design projects using the same `tool_ops` contract as the built-in Design Agent.

## Enable

```bash
# apps/api/.env
MCP_CANVAS_ENABLED=true

# apps/web/.env — required for live apply while the editor is open
VITE_MCP_CANVAS_ENABLED=true
```

Restart API and web after changing env vars.

## Modes

| Mode | When | What happens |
|------|------|----------------|
| **Live** | Editor open + heartbeat | Ops queue to Redis → `McpCanvasBridge` applies via `designTools` (full op set) |
| **Headless** | Editor closed | API validates ops and patches the project document directly |

Complex ops (`boolean_op`, `align_nodes`, `image_process`, …) need **Live** mode. Basic create/update/delete work headless.

### FE bridge cadence

`McpCanvasBridge` uses **one** `pollMs` interval (default 1500ms). Each tick: heartbeat → fetch/apply pending batches → reload if project revision bumped. There is no separate heartbeat timer.

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/mcp/canvas/tools` | Tool catalog (OpenAI function schema) |
| `POST /api/v1/mcp/canvas/call` | Invoke a tool |
| `POST /api/v1/mcp/canvas/session/heartbeat` | Editor live session (FE) |
| `GET /api/v1/mcp/canvas/pending` | Fetch queued ops (FE) |
| `POST /api/v1/mcp/canvas/pending/ack` | Ack applied batch (FE) |

Auth: Bearer token (same as web API). Every call needs `project_id` in tool arguments (or `RECOMBYN_PROJECT_ID` in the stdio bridge env).

## Codex

Add to project `.codex/config.toml` (or `~/.codex/config.toml`):

```toml
[mcp_servers.recombyn-canvas]
command = "node"
args = ["scripts/mcp/recombyn_canvas_stdio.mjs"]

[mcp_servers.recombyn-canvas.env]
RECOMBYN_API_URL = "http://127.0.0.1:8000"
RECOMBYN_TOKEN = "<your-access-token>"
RECOMBYN_PROJECT_ID = "<project-id>"
```

Restart Codex (or run `codex mcp list`) after saving so the server is picked up.

**Get a token** (local dev):

```bash
SUPER_ADMIN_TEST_CODE=888888 node scripts/ci-mint-token.mjs
# → writes .tmp-token.txt
```

**Project id**: open a project in the editor — id is in the URL, or list via `GET /api/v1/projects`.

## Key tools

| Tool | Purpose |
|------|---------|
| `get_scene_summary` | Node/frame inventory + counts |
| `list_nodes` / `list_frames` | Scene detail |
| `apply_tool_ops` | Batch apply validated ops |
| `create_shape`, `create_text`, … | Single op shortcuts (same as Agent) |

Full catalog: `GET /api/v1/mcp/canvas/tools` or MCP `tools/list` via the stdio bridge.

## Related

- Tool registry seed: `apps/api/seeds/mcp/canvas_tools.yaml`
- Stdio bridge: `scripts/mcp/recombyn_canvas_stdio.mjs`
- FE bridge: `apps/web/src/components/editor/mcp/McpCanvasBridge.tsx`
- Agent react tools: `apps/api/app/services/llm/mcp_canvas_tools.py`
