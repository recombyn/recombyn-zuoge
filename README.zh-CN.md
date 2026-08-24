<p align="center">
  <a href="docs/self-hosting.md"><strong>自托管</strong></a> ·
  <a href="https://recombyn.com"><strong>Cloud</strong></a> ·
  <a href="https://recombyn.github.io/recombyn/"><strong>文档</strong></a>
</p>

<p align="center">
  <a href="docs/self-hosting.md"><img src="https://img.shields.io/badge/self--host-Docker%20Compose-2496ED?logo=docker&logoColor=white" alt="Self-host" /></a>
  <a href="apps/web"><img src="https://img.shields.io/badge/web-React%20%2B%20TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="apps/api"><img src="https://img.shields.io/badge/api-FastAPI%20%2B%20Python-3776AB?logo=python&logoColor=white" alt="Python" /></a>
</p>

<p align="center">
  <a href="README.md"><img src="docs/assets/lang-en.png" alt="English" height="28" /></a>
  &nbsp;
  <a href="README.zh-CN.md"><img src="docs/assets/lang-zh-CN.png" alt="简体中文" height="28" /></a>
  &nbsp;
  <a href="README.ja.md"><img src="docs/assets/lang-ja.png" alt="日本語" height="28" /></a>
</p>

**Recombyn** 是一个开源的 AI 设计工作台，提供可编辑的无限矢量画布与 Design Agent。你可以用自然语言创建和修改图形、文字、布局与样式，也可以在画布中继续精细编辑，并通过 Docker Compose 自托管。

内置 Design Agent（LangGraph）：自然语言就能建图层、画图形、改样式、排版布局。自带多套 Skill，也可自定义 Skill / AgentProfile（YAML）/ 提示词包，扩展海报、仪表盘、落地页等品类；做完后仍可在矢量画布上精细改。

你可以在几分钟内用 Docker Compose 自托管（默认 **MySQL** + Redis + Web + API + **Yjs 协作**）。本地开发可空 `DATABASE_URL` 用 **SQLite**；也可切 **PostgreSQL**（见 [docs/postgres-switch.md](docs/postgres-switch.md)）。

---

## 帮忙点个 ⭐ Star

开源不易，如果觉得 Recombyn 对你有帮助，欢迎在 GitHub 仓库右上角点个 ⭐ Star。

→ [https://github.com/recombyn/recombyn](https://github.com/recombyn/recombyn)

## 画布

自研 **RCB** 无限画布：场景图是 `SceneDocument`，缩放范围为 5%–10000%。已提交图元默认按节点使用 **SVG** 绘制；网格和符合条件的远距离轻量图元使用 Canvas2D LOD 代理。命中采用空间索引、AABB 与 **Path2D** 几何协同处理，降低大文档的渲染与交互成本。

工程细节：[docs/canvas-architecture.md](docs/canvas-architecture.md) · Scene JSON：[docs/scene-json-spec.md](docs/scene-json-spec.md)。

你可以在画布上：

- 建画板、形状、文字、图片、视频、Lottie；用钢笔 / 铅笔（填充轮廓矢量笔刷）画路径，选区与变换  
- 做 **布尔运算**（并 / 差 / 交等）  
- 调 **描边对齐**：居中 / **内描边** / **外描边**  
- **轮廓化**（描边 → 可编辑填充路径）再改路径  
- 填色、圆角、混合模式、透明度、图层叠放；导出与分享  
- 开 **Yjs** 实时协作（光标、选区、撤销；`apps/collab`）

## Design Agent

流式对话 Agent：你说需求，它在同一张画布上规划、挂 Skill、调工具，把结果写回去——落地页、海报、改稿都行。

### 怎么分层的

执行内核固定为 LangGraph 模板 `canvas_ops_v1`；品类与行为靠配置改（AgentProfile YAML / 提示词包 / Skills / Tools），不用改内核。

| 层 | 职责 | 不该做什么 |
|----|------|------------|
| **Kernel** | 控制循环、工具调度、画布读写、轮次 / 权限 / ops 白名单 | 不写审美与品类工艺 |
| **AgentProfile（YAML）** | 阶段协议、路由、角色、子代理、capabilities | 不替代 LangGraph 注册表 |
| **Stage 提示词包** | 每阶段 turn 协议（intent / decide / paint / review…） | 不是某品类的工艺教材 |
| **Skills** | 品类 playbook（构图、节奏、评审标准、few-shot） | 不改 JSON 图元 / patch 协议 |
| **Tools** | 原子画布操作（`create_frame`、`update_node`…） | 不含业务审美 |

典型一轮：`intent` →（闲聊 settle / 小改 `paint` / 设计 `decide`）→ `paint` 产出 `tool_ops` → `observe` → 可选 **Review 子代理** → settle。细节见 **[docs/agent-profile.md](docs/agent-profile.md)**。

### Skills

每个技能一个目录：`skills/foundation/<key>/` 或 `skills/domains/<key>/`（`_meta.json` + `SKILL.md`；可选 `schema.json`、`assets/` 等）。

- **`_meta.json`**：什么时候用、触发词、`preferred_tools`、互斥组 —— Decide 靠它选技能  
- **`SKILL.md`**：这个品类怎么做（落地页 / 海报 / 简历 / 仪表盘 / 动效……）

仓库里已有多套（landing、poster、resume、dashboard、motion、ecommerce…）。你可以继续加目录，数量不封顶。

### Tools

画布原子操作登记在 [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json)。Agent 在 paint 阶段发出结构化 `tool_ops`，宿主校验后再落到画布。Skill 可以声明偏好工具，但不能发明协议外的 op。

### 你要改 Agent，动这些文件

| 文件 | 用途 |
|------|------|
| [`apps/api/seeds/agents/profiles/design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml) | **默认 Profile**：阶段、roles、subagents、skills/tools catalog、`$kv` 路由 |
| [`apps/api/seeds/agents/bindings.yaml`](apps/api/seeds/agents/bindings.yaml) | `product` / `surface` → 用哪个 Profile |
| [`apps/api/seeds/design_prompt_packs/`](apps/api/seeds/design_prompt_packs/) | 各 stage 提示词正文 |
| [`skills/`](skills/) | 新增 / 改技能（foundation + domains） |
| [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) | 工具目录 |
| `apps/api/.env` → `AGENT_PROFILE_ID` | 强制指定 Profile（默认 `design.canvas`；空串则走 bindings） |

**换一个 Agent（示例）**

1. 复制 `profiles/design.canvas.yaml` → `profiles/my.agent.yaml`，改 `id:` / `metadata` / `identity` / `capabilities` 等  
2. 在 `bindings.yaml` 里把对应 `when` 指到新 id，或设 `AGENT_PROFILE_ID=my.agent`  
3. 重启 API；Profile 从磁盘加载（不是 DB 行）

**加一个 Skill（示例）**

1. 新建 `design_skills/my_scene/_meta.json` + `SKILL.md`  
2. 填触发条件与 `preferred_tools`  
3. 重启 / 重新 ensure seeds 后，Decide 即可按触发挂上

额外 Skill 包也可以放在 [`plugins/skills/`](plugins/skills/)（Compose 已挂载）。写法见 [docs/skill-extensions.md](docs/skill-extensions.md)。

环境开关（Review、超时等）：[docs/agent-profile.md § Env knobs](docs/agent-profile.md#env-knobs)。种子总览：[`apps/api/seeds/README.md`](apps/api/seeds/README.md)。模型密钥：[docs/self-hosting.md](docs/self-hosting.md)。

## 插件与扩展

两条扩展面，别混用：

| 类型 | 路径 | 扩展什么 | 示例 |
|------|------|----------|------|
| **Skill 包** | [`plugins/skills/<key>/`](plugins/skills/) | Design Agent 品类工艺（布局同 `skills/`） | [`festival_poster`](plugins/skills/festival_poster/) |
| **画布插件** | [`plugins/canvas/<id>/`](plugins/canvas/) | 编辑器 UI（目前：底部工具条按钮） | [`watermark`](plugins/canvas/watermark/) |

**Skill 包**

1. 在 `plugins/skills/<key>/` 放入 `_meta.json` + `SKILL.md`（可选 `handler.py`、`schema.json`、`assets/`）  
2. Compose 已挂载 `./plugins/skills` → API；也可设 `DESIGN_SKILLS_PLUGIN_DIRS`  
3. 重启 API / 等热更新，用触发词对话试试（例：「生成中秋红色海报」）

可选：设 `DESIGN_SKILL_OPS_RUNNER=true`，`handler.py` 可在 LLM paint 前产出 `tool_ops`。详见 [docs/skill-extensions.md](docs/skill-extensions.md)。

**画布插件**

1. 在 `plugins/canvas/<id>/` 加 `manifest.json` + `index.ts`  
2. 在 `ensureCanvasPlugins()`（`apps/web/src/plugins/canvas/host.ts`）里注册  
3. 重新构建 / 刷新 Web  

详见 [docs/canvas-plugins.md](docs/canvas-plugins.md)。

**打包成 `.recombyn-plugin`**

```bash
node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster
# → dist/plugins/<id>-<version>.recombyn-plugin
# 技能库上传，或 POST /api/v1/design/plugins/install
# 写盘安装需 DESIGN_PLUGIN_DISK_INSTALL=true
```

→ [docs/plugin-packs.md](docs/plugin-packs.md) · [plugins/skills/README.md](plugins/skills/README.md) · [plugins/canvas/README.md](plugins/canvas/README.md)

## 快速开始（自托管）

```bash
git clone https://github.com/recombyn/recombyn.git
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
  src-tauri/       Tauri v2 桌面壳（Recombyn）
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

官网：[recombyn.com](https://recombyn.com) · 文档：[recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) · 源码：[github.com/recombyn/recombyn](https://github.com/recombyn/recombyn)
