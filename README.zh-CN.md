<div align="center">
  <img src="apps/web/public/brand/zuoge-wordmark.png" alt="左格" height="140" style="margin-top: 48px; margin-bottom: 40px;" />

  <p>
    <a href="docs/self-hosting.md"><strong>自托管</strong></a> ·
    <a href="https://recombyn.com"><strong>Cloud</strong></a> ·
    <a href="https://recombyn.github.io/recombyn/"><strong>文档</strong></a>
  </p>

  <p>
    <a href="docs/self-hosting.md"><img src="https://img.shields.io/badge/self--host-Docker%20Compose-2496ED?logo=docker&logoColor=white" alt="Self-host" /></a>
    <a href="apps/web"><img src="https://img.shields.io/badge/web-React%20%2B%20TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
    <a href="apps/api"><img src="https://img.shields.io/badge/api-FastAPI%20%2B%20Python-3776AB?logo=python&logoColor=white" alt="Python" /></a>
  </p>

  <p>
    <a href="README.md"><img src="docs/assets/lang-en.png" alt="English" height="28" /></a>
    &nbsp;
    <a href="README.zh-CN.md"><img src="docs/assets/lang-zh-CN.png" alt="简体中文" height="28" /></a>
    &nbsp;
    <a href="README.ja.md"><img src="docs/assets/lang-ja.png" alt="日本語" height="28" /></a>
  </p>

  <p><strong>做个，设计从未如此简单</strong></p>
</div>

**左格**是开源 AI 设计工作台：无限矢量画布、LangGraph Design Agent，以及 **MCP 服务**——Cursor 等外部工具可读写同一项目。Docker Compose 自托管；本地开发默认 SQLite（可选 [PostgreSQL](docs/postgres-switch.md)）。

## MCP 画布

外部客户端通过 [Model Context Protocol](https://modelcontextprotocol.io) 连接，使用与内置 Agent 相同的 `tool_ops` 合约。

| 模式 | 行为 |
|------|------|
| **Live** | 编辑器打开 → 浏览器实时 apply |
| **Headless** | 编辑器关闭 → API 直接 patch 文档 |

```bash
# apps/api/.env
MCP_CANVAS_ENABLED=true
# apps/web/.env — 编辑时 Live apply
VITE_MCP_CANVAS_ENABLED=true
```

Cursor — 写入 `.cursor/mcp.json`：

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

冒烟测试：`SUPER_ADMIN_TEST_CODE=… node scripts/mcp/test-canvas-e2e.mjs` · [docs/mcp-canvas.md](docs/mcp-canvas.md)

---

## 帮忙点个 ⭐ Star

开源不易，如果觉得左格对你有帮助，欢迎在 GitHub 仓库右上角点个 ⭐ Star。

→ [https://github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)

## 画布

无限矢量画布（`SceneDocument`，5%–10000% 缩放）：SVG 节点、Path2D 命中、Canvas2D LOD。画板、形状、文字、图片、钢笔/铅笔、布尔运算、描边对齐、导出、**Yjs** 协作。

→ [docs/canvas-architecture.md](docs/canvas-architecture.md) · [docs/scene-json-spec.md](docs/scene-json-spec.md)

## Design Agent

同一张画布上的流式对话：规划 → 挂 Skill → 产出 `tool_ops` → 落笔。LangGraph 内核固定（`canvas_ops_v1`）；行为由 **AgentProfile** YAML、阶段提示词、**Skills** 与工具注册表配置。

| 定制项 | 位置 |
|--------|------|
| Profile / 路由 | [`design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml)、[`bindings.yaml`](apps/api/seeds/agents/bindings.yaml) |
| Skills | [`skills/`](skills/) · [`plugins/skills/`](plugins/skills/) |
| 画布 ops | [`canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) |

流程图、环境变量、增删 Profile：**[docs/agent-profile.md](docs/agent-profile.md)** · [seeds README](apps/api/seeds/README.md)

## 插件与扩展

| 类型 | 路径 | 文档 |
|------|------|------|
| **Skill 包** | [`plugins/skills/<key>/`](plugins/skills/) | [skill-extensions.md](docs/skill-extensions.md) |
| **画布插件** | [`plugins/canvas/<id>/`](plugins/canvas/) | [canvas-plugins.md](docs/canvas-plugins.md) |

打包：`node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster` → [plugin-packs.md](docs/plugin-packs.md)

## 快速开始（自托管）

```bash
git clone https://github.com/recombyn/zuoge.git
cd recombyn
cp apps/api/.env.example apps/api/.env   # 填入 LLM_API_KEY 等
docker compose up -d --build
```

| 服务 | 地址 |
|------|------|
| Web | http://localhost:3000 |
| API 文档 | http://localhost:8000/docs |
| MySQL | `127.0.0.1:3306` · `recombyn` / `recombyn` |

更多选项（环境变量、模型密钥、生产加固）：**[docs/self-hosting.md](docs/self-hosting.md)** · Postgres：**[docs/postgres-switch.md](docs/postgres-switch.md)**

### 本地开发

```bash
docker compose up -d redis
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api              # 空 DATABASE_URL → SQLite
npm run dev:collab           # Yjs WS :1234（可选；Vite DEV 默认开协作）
npm run dev:web
```

Canvas Live / WSS：**[docs/self-hosting.md § Canvas multiplayer](docs/self-hosting.md#canvas-multiplayer-yjs--wss)** · [apps/collab/README.md](apps/collab/README.md)

### 桌面端（Tauri）

详见 **[docs/desktop.md](docs/desktop.md)**。需要 **Rust** 与平台工具链。

```bash
# 单机 — 内嵌 API sidecar + SQLite
npm run dev:desktop
npm run build:desktop:sidecar
npm run build:desktop

# 云端桌面 — 与浏览器同一套本机 API（:8000 / .env）
# 有公网部署时再设 VITE_API_BASE_URL
npm run dev:desktop:cloud
npm run build:desktop:cloud
```

打包产物：`apps/web/src-tauri/target/release/bundle/`（安装包）；主程序 `…/target/release/recombyn.exe`。

## 仓库结构

```
apps/web/          React 画布 + Agent UI + Yjs 客户端
  src-tauri/       Tauri v2 桌面壳（zuoge）
apps/api/          FastAPI（含 collab room-token）
apps/collab/       Yjs WebSocket 服务（y-websocket）
plugins/           扩展（skills + canvas）— Compose 已挂载
packages/          共享协议
docs/              自托管、Agent、插件、桌面端、画布
deploy/            Dockerfile / Nginx
e2e/               Playwright
```

用户文档：[recombyn.github.io/recombyn/](https://recombyn.github.io/recombyn/)（由本仓库 `gh-pages` 发布）。

## 文档与社区

| | |
|--|--|
| 用户文档 | [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) |
| MCP 画布（Cursor / 外部 AI） | [docs/mcp-canvas.md](docs/mcp-canvas.md) |
| 自托管 / 架构 | [docs/self-hosting.md](docs/self-hosting.md) |
| Skill 扩展 | [docs/skill-extensions.md](docs/skill-extensions.md) |
| 画布插件 | [docs/canvas-plugins.md](docs/canvas-plugins.md) |
| 插件包（`.recombyn-plugin`） | [docs/plugin-packs.md](docs/plugin-packs.md) |
| AgentProfile / 子代理 | [docs/agent-profile.md](docs/agent-profile.md) |
| 画布（RCB / SVG / Path2D / LOD） | [docs/canvas-architecture.md](docs/canvas-architecture.md) |
| Web 数据层（Query / oRPC / nuqs） | [docs/web-frontend.md](docs/web-frontend.md) |
| Scene JSON | [docs/scene-json-spec.md](docs/scene-json-spec.md) |
| 桌面端 | [docs/desktop.md](docs/desktop.md) |
| Postgres | [docs/postgres-switch.md](docs/postgres-switch.md) |
| 贡献 · 安全 · 行为准则 | [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

官网：[recombyn.com](https://recombyn.com) · 文档：[recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) · 源码：[github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)
