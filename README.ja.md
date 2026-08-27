<div align="center">
  <img src="docs/assets/zuoge-wordmark-en.png" alt="zuoge" height="140" style="margin-top: 48px; margin-bottom: 40px;" />

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
  <p><strong>作ろう、デザインがこんなに簡単だったことはない</strong></p>
</div>

**zuoge** はオープンソースの AI デザインワークスペースです。無限ベクターキャンバス、LangGraph Design Agent、**MCP サーバー**（Cursor など外部クライアントが同一プロジェクトを編集）を備えます。Docker Compose でセルフホスト。

## GitHub で ⭐ Star を

オープンソースは時間がかかります。zuoge が役に立ったら、右上の **⭐ Star** をお願いします。

→ [https://github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)

## MCP キャンバス

外部クライアントは [Model Context Protocol](https://modelcontextprotocol.io) 経由で接続し、内蔵 Agent と同じ `tool_ops` 契約を使います。

| モード | 動作 |
|--------|------|
| **Live** | エディタ起動中 → ブラウザで apply |
| **Headless** | エディタ未起動 → API がドキュメントを patch |

```bash
# apps/api/.env
MCP_CANVAS_ENABLED=true
# apps/web/.env — 編集中の Live apply
VITE_MCP_CANVAS_ENABLED=true
```

Cursor — `.cursor/mcp.json` に追加:

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

## キャンバス

無限ベクターキャンバス（`SceneDocument`、5%–10000% ズーム）：SVG ノード、Path2D ヒット、Canvas2D LOD。フレーム、図形、テキスト、画像、ペン/鉛筆、ブール演算、ストローク揃え、エクスポート、**Yjs** コラボ。

→ [docs/canvas-architecture.md](docs/canvas-architecture.md) · [docs/scene-json-spec.md](docs/scene-json-spec.md)

## Design Agent

同一キャンバス上のストリーミング会話：計画 → Skill → `tool_ops` → 適用。LangGraph カーネル固定（`canvas_ops_v1`）；挙動は **AgentProfile** YAML、段階プロンプト、**Skills**、ツール登録で設定。

| カスタム | 場所 |
|----------|------|
| Profile / ルーティング | [`design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml)、[`bindings.yaml`](apps/api/seeds/agents/bindings.yaml) |
| Skills | [`skills/`](skills/) · [`plugins/skills/`](plugins/skills/) |
| キャンバス ops | [`canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) |

グラフ、env、Profile 追加/差替：**[docs/agent-profile.md](docs/agent-profile.md)** · [seeds README](apps/api/seeds/README.md)

## プラグインと拡張

| 種類 | パス | ドキュメント |
|------|------|--------------|
| **Skill パック** | [`plugins/skills/<key>/`](plugins/skills/) | [skill-extensions.md](docs/skill-extensions.md) |
| **Canvas プラグイン** | [`plugins/canvas/<id>/`](plugins/canvas/) | [canvas-plugins.md](docs/canvas-plugins.md) |

パック：`node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster` → [plugin-packs.md](docs/plugin-packs.md)

## クイックスタート（セルフホスト）

```bash
git clone https://github.com/recombyn/zuoge.git
cd recombyn
cp apps/api/.env.example apps/api/.env   # LLM_API_KEY / プロバイダキーを設定
docker compose up -d --build
```

| サービス | URL |
|---------|-----|
| Web | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| MySQL | `127.0.0.1:3306` · `recombyn` / `recombyn` |

詳細（env、LLM、本番 hardening）: **[docs/self-hosting.md](docs/self-hosting.md)** · Postgres: **[docs/postgres-switch.md](docs/postgres-switch.md)**

### ローカル開発

```bash
docker compose up -d redis   # または: mysql redis
npm install
cp apps/api/.env.example apps/api/.env
npm run dev:api              # 空 DATABASE_URL → SQLite
npm run dev:collab           # Yjs WS :1234（任意）
npm run dev:web
```

Canvas Live / WSS: **[docs/self-hosting.md § Canvas multiplayer](docs/self-hosting.md#canvas-multiplayer-yjs--wss)** · [apps/collab/README.md](apps/collab/README.md)

### デスクトップ（Tauri）

**[docs/desktop.md](docs/desktop.md)** を参照。**Rust** と OS ビルドツールが必要です。

```bash
# デスクトップ — ブラウザと同じ API（:8000 / .env）
npm run dev:desktop
npm run build:desktop
# 公開デプロイ時は VITE_API_BASE_URL
```

成果物: `apps/web/src-tauri/target/release/bundle/`（インストーラ）；本体 `…/target/release/recombyn.exe`。

## リポジトリ構成

```
apps/web/          React キャンバス + Agent UI + Yjs クライアント
  src-tauri/       Tauri v2 デスクトップシェル（zuoge）
apps/api/          FastAPI — Scene, Agent, plaza, wallet, collab tokens
apps/collab/       Yjs WebSocket サーバー（y-websocket）
plugins/           拡張（skills + canvas）— Compose マウント
packages/          共有ビルダー & スキーマ
docs/              セルフホスト、デプロイ、課金、Agent、プラグイン、デスクトップ、キャンバス
deploy/            Dockerfile / Nginx
e2e/               Playwright
```

ユーザー向けドキュメント：[recombyn.github.io/recombyn/](https://recombyn.github.io/recombyn/)（本リポジトリの `gh-pages` から公開）。

## ドキュメント / コミュニティ

| | |
|--|--|
| ユーザー向け | [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) |
| MCP キャンバス（Cursor / 外部 AI） | [docs/mcp-canvas.md](docs/mcp-canvas.md) |
| セルフホスト / 構成 | [docs/self-hosting.md](docs/self-hosting.md) |
| デプロイモード | [docs/deployment-modes.md](docs/deployment-modes.md) |
| 課金・クレジット | [docs/billing.md](docs/billing.md) |
| Skill 拡張 | [docs/skill-extensions.md](docs/skill-extensions.md) |
| Canvas プラグイン | [docs/canvas-plugins.md](docs/canvas-plugins.md) |
| プラグインパック（`.recombyn-plugin`） | [docs/plugin-packs.md](docs/plugin-packs.md) |
| AgentProfile | [docs/agent-profile.md](docs/agent-profile.md) |
| キャンバス | [docs/canvas-architecture.md](docs/canvas-architecture.md) |
| デスクトップ | [docs/desktop.md](docs/desktop.md) |
| Postgres | [docs/postgres-switch.md](docs/postgres-switch.md) |
| コントリビュート · セキュリティ · CoC | [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

公式: [recombyn.com](https://recombyn.com) · Docs: [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) · Source: [github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)
