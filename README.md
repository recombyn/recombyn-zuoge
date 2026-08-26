<div align="center">
  <img src="docs/assets/zuoge-wordmark-en.png" alt="zuoge" height="140" style="margin-top: 20px; margin-bottom: 20px;" />

  <p>
    <a href="docs/self-hosting.md"><strong>Self Host</strong></a> ·
    <a href="https://recombyn.com"><strong>Cloud</strong></a> ·
    <a href="https://recombyn.github.io/recombyn/"><strong>Docs</strong></a>
  </p>

  <p>
    <a href="docs/self-hosting.md"><img src="https://img.shields.io/badge/self--host-Docker%20Compose-2496ED?logo=docker&logoColor=white" alt="Self-host" /></a>
    <a href="apps/web"><img src="https://img.shields.io/badge/web-React%20%2B%20TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="apps/api"><img src="https://img.shields.io/badge/api-FastAPI%20%2B%20Python-3776AB?logo=python&logoColor=white" alt="Python" /></a>
    <a href="SECURITY.md"><img src="https://img.shields.io/badge/security-policy-green.svg" alt="Security" /></a>
  </p>

  <p>
    <a href="README.md"><img src="docs/assets/lang-en.png" alt="English" height="28" /></a>
    &nbsp;
    <a href="README.zh-CN.md"><img src="docs/assets/lang-zh-CN.png" alt="简体中文" height="28" /></a>
    &nbsp;
    <a href="README.ja.md"><img src="docs/assets/lang-ja.png" alt="日本語" height="28" /></a>
  </p>
  <p><strong>Make it — design has never been this simple</strong></p>
</div>

**zuoge** is an open-source AI design workspace: infinite vector canvas, LangGraph Design Agent, and an **MCP server** so tools like Cursor can read and edit the same projects. Self-host with Docker Compose.

## Star us on GitHub ⭐

Open source takes time. If zuoge helps you, please hit **⭐ Star** in the top-right of the GitHub repo.

→ [https://github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)

## MCP canvas

External clients connect via [Model Context Protocol](https://modelcontextprotocol.io) and use the same `tool_ops` contract as the built-in Agent.

| Mode | Behavior |
|------|----------|
| **Live** | Editor open → ops apply in the browser |
| **Headless** | Editor closed → API patches the project document |

```bash
# apps/api/.env
MCP_CANVAS_ENABLED=true
# apps/web/.env — live apply while editing
VITE_MCP_CANVAS_ENABLED=true
```

Cursor — add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "recombyn-canvas": {
      "command": "node",
      "args": ["scripts/mcp/recombyn_canvas_stdio.mjs"],
      "env": {
        "RECOMBYN_API_URL": "http://127.0.0.1:8000",
        "RECOMBYN_TOKEN": "<token>",
        "RECOMBYN_PROJECT_ID": "<project-id>"
      }
    }
  }
}
```

→ [docs/mcp-canvas.md](docs/mcp-canvas.md)

## Canvas

Infinite vector canvas (`SceneDocument`, 5%–10000% zoom): SVG nodes, Path2D hit testing, Canvas2D LOD. Frames, shapes, text, images, pen/pencil, boolean ops, stroke align, export, **Yjs** collab.

→ [docs/canvas-architecture.md](docs/canvas-architecture.md) · [docs/scene-json-spec.md](docs/scene-json-spec.md)

## Design Agent

Streaming chat on the same canvas: plan → Skills → `tool_ops` → apply. Fixed LangGraph kernel (`canvas_ops_v1`); behavior from **AgentProfile** YAML, stage prompts, **Skills**, and the tool registry.

| Customize | Where |
|-----------|--------|
| Profile / routing | [`design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml), [`bindings.yaml`](apps/api/seeds/agents/bindings.yaml) |
| Skills | [`skills/`](skills/) · [`plugins/skills/`](plugins/skills/) |
| Canvas ops | [`canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) |

Graph, env knobs, add/swap profiles: **[docs/agent-profile.md](docs/agent-profile.md)** · [seeds README](apps/api/seeds/README.md)

## Plugins & extensions

| Kind | Path | Docs |
|------|------|------|
| **Skill pack** | [`plugins/skills/<key>/`](plugins/skills/) | [skill-extensions.md](docs/skill-extensions.md) |
| **Canvas plugin** | [`plugins/canvas/<id>/`](plugins/canvas/) | [canvas-plugins.md](docs/canvas-plugins.md) |

Pack: `node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster` → [plugin-packs.md](docs/plugin-packs.md)

## Quick start (self-host)

```bash
git clone https://github.com/recombyn/zuoge.git
cd recombyn
cp apps/api/.env.example apps/api/.env   # add LLM_API_KEY / provider keys
docker compose up -d --build
```

| Service | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| MySQL | `127.0.0.1:3306` · `recombyn` / `recombyn` |

More options (env, LLM keys, production hardening): **[docs/self-hosting.md](docs/self-hosting.md)** · Postgres: **[docs/postgres-switch.md](docs/postgres-switch.md)**

### Compose recipes

Use `docker-compose.yml` as the base stack, then layer overrides only when needed:

```bash
# 1) Base self-host stack (web + api + collab + mysql + redis + worker)
docker compose -f docker-compose.yml up -d --build

# 2) Base + ClamAV upload scanning
docker compose --profile av \
  -f docker-compose.yml \
  -f docker-compose.av.yml \
  up -d --build

# 3) Base + optional Design Intelligence HTTP provider
docker compose --profile intelligence \
  -f docker-compose.yml \
  -f docker-compose.intelligence.yml \
  up -d --build

# 4) Base stack from pre-built GHCR images (skip local image builds)
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml pull
docker compose -f docker-compose.yml -f docker-compose.ghcr.yml up -d
```

Tip: if you layer `*.av.yml` or `*.intelligence.yml`, keep the matching profile flag (`--profile av` / `--profile intelligence`) in the same command.

Env tip: keep Compose variables in repo-root `.env` (for example `RECOMBYN_TAG`, `RECOMBYN_INTELLIGENCE_*`) and API app variables in `apps/api/.env`; avoid passing env values inline in shell commands.

### Local development

```bash
docker compose up -d redis   # or: mysql redis
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api              # empty DATABASE_URL → SQLite
npm run dev:collab           # Yjs WS on :1234 (optional; Vite DEV defaults collab on)
npm run dev:web
```

Canvas Live / WSS setup: **[docs/self-hosting.md § Canvas multiplayer](docs/self-hosting.md#canvas-multiplayer-yjs--wss)** · [apps/collab/README.md](apps/collab/README.md)

### Desktop (Tauri)

See **[docs/desktop.md](docs/desktop.md)**. Needs **Rust** + platform toolchain.

```bash
# Local — bundled API sidecar + SQLite
npm run dev:desktop
npm run build:desktop:sidecar
npm run build:desktop

# Cloud — same API as browser (:8000 / .env)
# Optional: VITE_API_BASE_URL when hosted
npm run dev:desktop:cloud
npm run build:desktop:cloud
```

Build output: `apps/web/src-tauri/target/release/bundle/` (installers); main binary `…/target/release/recombyn.exe`.

## Repository layout

```
apps/web/          React canvas + Agent UI + Yjs client
  src-tauri/       Tauri v2 desktop shell (zuoge)
apps/api/          FastAPI — Scene, Agent, plaza, wallet, collab tokens
apps/collab/       Yjs WebSocket server (y-websocket)
plugins/           Extensions (skills + canvas) — Compose-mounted
packages/          Shared builders & schemas
docs/              self-hosting, agent-profile, plugins, desktop, canvas
deploy/            Dockerfiles / Nginx
e2e/               Playwright
```

User docs: [recombyn.github.io/recombyn/](https://recombyn.github.io/recombyn/) (published from this repo’s `gh-pages`).

## Documentation

| | |
|--|--|
| User docs | [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) |
| MCP canvas (Cursor / external AI) | [docs/mcp-canvas.md](docs/mcp-canvas.md) |
| Self-host / architecture | [docs/self-hosting.md](docs/self-hosting.md) |
| Skill extensions | [docs/skill-extensions.md](docs/skill-extensions.md) |
| Canvas plugins | [docs/canvas-plugins.md](docs/canvas-plugins.md) |
| Plugin packs (`.recombyn-plugin`) | [docs/plugin-packs.md](docs/plugin-packs.md) |
| AgentProfile / sub-agents | [docs/agent-profile.md](docs/agent-profile.md) |
| Canvas (RCB / SVG / Path2D / LOD) | [docs/canvas-architecture.md](docs/canvas-architecture.md) |
| Web data layer (Query / oRPC / nuqs) | [docs/web-frontend.md](docs/web-frontend.md) |
| Scene JSON | [docs/scene-json-spec.md](docs/scene-json-spec.md) |
| Desktop | [docs/desktop.md](docs/desktop.md) |
| Postgres | [docs/postgres-switch.md](docs/postgres-switch.md) |
| Contributing · Security · CoC | [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

## Community

- **Issues** — bug & feature templates under `.github/ISSUE_TEMPLATE/`
- **PRs** — see [CONTRIBUTING.md](CONTRIBUTING.md)
- **Security** — report privately per [SECURITY.md](SECURITY.md)

Official: [recombyn.com](https://recombyn.com) · Docs: [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) · Source: [github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)
