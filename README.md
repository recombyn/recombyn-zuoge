<div align="center">
  <img src="docs/assets/zuoge-wordmark-en.png" alt="zuoge" height="140" />

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

**zuoge** (Chinese brand **左格**, literally “make / do one”) is an open-source AI design workspace with an editable infinite vector canvas and a Design Agent. The product slogan is **「做个，设计从未如此简单」** — *Make it; design has never been this simple*. Use natural language to create and revise shapes, text, layouts, and styles, continue refining directly on the canvas, and self-host with Docker Compose.

Built-in Design Agent (LangGraph): natural language creates layers, draws shapes, restyles, and typesets. Ships with Skills out of the box; you can also add custom Skills / AgentProfile (YAML) / prompt packs for posters, dashboards, landing pages, and more — then keep editing at vector precision.

You can self-host in a few minutes with Docker Compose (default **MySQL** + Redis + web + API + **Yjs collab**). For local dev, leave `DATABASE_URL` empty for **SQLite**, or switch to **PostgreSQL** — see [docs/postgres-switch.md](docs/postgres-switch.md).

---

## Star us on GitHub ⭐

Open source takes time. If zuoge helps you, please hit **⭐ Star** in the top-right of the GitHub repo.

→ [https://github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)

## Canvas

Custom infinite canvas: the scene graph is `SceneDocument`, with a 5%–10000% zoom range. Committed nodes normally paint as per-node **SVG**; the grid and eligible lightweight far-out nodes use Canvas2D LOD proxies. Hit testing combines the spatial index, AABB checks, and **Path2D** geometry to keep large documents responsive.

Details: [docs/canvas-architecture.md](docs/canvas-architecture.md) · Scene JSON: [docs/scene-json-spec.md](docs/scene-json-spec.md).

You can:

- Build frames, shapes, text, images, video, Lottie; draw with pen / pencil (filled-ribbon vector brushes); select & transform  
- Run **boolean ops** (union / subtract / intersect, …)  
- Set **stroke align**: center / **inside** / **outside**  
- **Outline** a stroke into an editable filled path, then edit the path  
- Fill, corner radius, blend modes, opacity, stacking; export & share  
- Turn on **Yjs** live collab (cursors, selection, undo; `apps/collab`)

## Design Agent

A streaming chat agent: you describe the job; it plans, attaches Skills, calls tools, and writes back onto the same canvas — landings, posters, revisions, and more.

### How it’s layered

The execution kernel is fixed: LangGraph template `canvas_ops_v1`. Category and behavior come from config (AgentProfile YAML / prompt packs / Skills / Tools) — you don’t have to touch the kernel.

| Layer | Owns | Must not |
|-------|------|----------|
| **Kernel** | Control loop, tool scheduling, canvas R/W, rounds / permissions / ops allowlist | Design taste or category craft |
| **AgentProfile (YAML)** | Stage protocol, routing, roles, sub-agents, capabilities | Replace the LangGraph registry |
| **Stage prompt packs** | Per-stage turn protocol (intent / decide / paint / review / …) | Category craft curricula |
| **Skills** | Domain playbooks (layout, rhythm, review bars, few-shots) | JSON element / patch schema |
| **Tools** | Atomic canvas ops (`create_frame`, `update_node`, …) | Business aesthetics |

Typical turn: `intent` → (chat settle / lean `paint` / design `decide`) → `paint` emits `tool_ops` → `observe` → optional **Review** sub-agent → settle. Full graph: **[docs/agent-profile.md](docs/agent-profile.md)**.

### Skills

One folder per skill: `skills/foundation/<key>/` or `skills/domains/<key>/` (`_meta.json` + `SKILL.md`; optional `schema.json`, `assets/`, …).

- **`_meta.json`** — when to use, triggers, `preferred_tools`, mutex — Decide picks skills from this  
- **`SKILL.md`** — how to craft that deliverable (landing, poster, resume, dashboard, motion, …)

The repo already ships many (landing, poster, resume, dashboard, motion, ecommerce…). You can keep adding folders — no fixed cap.

### Tools

Atomic canvas ops live in [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json). Paint emits structured `tool_ops`; the host validates and applies them. Skills may prefer tools; they cannot invent ops outside the registry.

### Files to change when you customize the Agent

| File | Purpose |
|------|---------|
| [`apps/api/seeds/agents/profiles/design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml) | **Default Profile**: stages, roles, subagents, skills/tools catalogs, `$kv` routing |
| [`apps/api/seeds/agents/bindings.yaml`](apps/api/seeds/agents/bindings.yaml) | `product` / `surface` → Profile id |
| [`apps/api/seeds/design_prompt_packs/`](apps/api/seeds/design_prompt_packs/) | Stage prompt bodies |
| [`skills/`](skills/) | Add / edit shipped skills (foundation + domains) |
| [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) | Tool catalog |
| `apps/api/.env` → `AGENT_PROFILE_ID` | Force Profile id (default `design.canvas`; empty → use bindings) |

**Swap / add an Agent**

1. Copy `profiles/design.canvas.yaml` → `profiles/my.agent.yaml`; change `id:` / identity / capabilities  
2. Point `bindings.yaml` at the new id, or set `AGENT_PROFILE_ID=my.agent`  
3. Restart the API (Profiles load from disk, not DB rows)

**Add a Skill**

1. Create `design_skills/my_scene/_meta.json` + `SKILL.md`  
2. Fill triggers + `preferred_tools`  
3. Restart / re-ensure seeds — Decide can attach it

Extra skill packs can also live under [`plugins/skills/`](plugins/skills/) (Compose-mounted). See [docs/skill-extensions.md](docs/skill-extensions.md).

Env knobs (Review on/off, timeouts): [docs/agent-profile.md § Env knobs](docs/agent-profile.md#env-knobs). Seeds overview: [`apps/api/seeds/README.md`](apps/api/seeds/README.md). Models: [docs/self-hosting.md](docs/self-hosting.md).

## Plugins & extensions

Two extension surfaces — don’t mix them up:

| Kind | Path | What it extends | Sample |
|------|------|-----------------|--------|
| **Skill pack** | [`plugins/skills/<key>/`](plugins/skills/) | Design Agent craft (same layout as `skills/`) | [`festival_poster`](plugins/skills/festival_poster/) |
| **Canvas plugin** | [`plugins/canvas/<id>/`](plugins/canvas/) | Editor UI (toolbar buttons today) | [`watermark`](plugins/canvas/watermark/) |

**Skill pack**

1. Drop `_meta.json` + `SKILL.md` under `plugins/skills/<key>/` (optional `handler.py`, `schema.json`, `assets/`).  
2. Compose already mounts `./plugins/skills` → API; or set `DESIGN_SKILLS_PLUGIN_DIRS`.  
3. Restart API / wait for hot reload — chat with a trigger (sample: 「生成中秋红色海报」).

Optional: `DESIGN_SKILL_OPS_RUNNER=true` lets `handler.py` emit `tool_ops` before LLM paint. Details: [docs/skill-extensions.md](docs/skill-extensions.md).

**Canvas plugin**

1. Add `manifest.json` + `index.ts` under `plugins/canvas/<id>/`.  
2. Register it in `ensureCanvasPlugins()` (`apps/web/src/plugins/canvas/host.ts`).  
3. Rebuild / refresh the web app.

Details: [docs/canvas-plugins.md](docs/canvas-plugins.md).

**Packaged install (`.recombyn-plugin`)**

```bash
node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster
# → dist/plugins/<id>-<version>.recombyn-plugin
# Upload via Skills library, or POST /api/v1/design/plugins/install
# Disk install needs DESIGN_PLUGIN_DISK_INSTALL=true
```

→ [docs/plugin-packs.md](docs/plugin-packs.md) · [plugins/skills/README.md](plugins/skills/README.md) · [plugins/canvas/README.md](plugins/canvas/README.md)

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
