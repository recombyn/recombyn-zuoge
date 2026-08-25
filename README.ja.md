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
  <p><strong>作ろう、デザインがこんなに簡単だったことはない</strong></p>
</div>

**zuoge** は、編集可能な無限ベクターキャンバスと Design Agent を備えたオープンソースの AI デザインワークスペースです。スローガンは **作ろう、デザインがこんなに簡単だったことはない**。自然言語で図形・テキスト・レイアウト・スタイルを作成・修正し、キャンバス上で仕上げ、Docker Compose でセルフホストできます。

内蔵 Design Agent（LangGraph）：自然言語でレイヤー作成・図形・スタイル・組版ができます。Skill を同梱しつつ、カスタム Skill / AgentProfile（YAML）/ プロンプトパックも追加でき、ポスター・ダッシュボード・LP など品類を広げたあと、ベクター精度で編集できます。

数分以内に Docker Compose でセルフホストできます（既定は **MySQL** + Redis + Web + API + **Yjs コラボ**）。ローカル開発では空の `DATABASE_URL` で **SQLite**、または **PostgreSQL** — [docs/postgres-switch.md](docs/postgres-switch.md) を参照。

---

## GitHub で ⭐ Star を

オープンソースは時間がかかります。zuoge が役に立ったら、右上の **⭐ Star** をお願いします。

→ [https://github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)

## キャンバス

自作の無限キャンバス。シーンは `SceneDocument`、ズームはおよそ 5%–10000%。確定図元はノード単位の **SVG**、ヒットテストと選択は **Path2D**。遠景は **LOD** で簡略化し、大きなドキュメントも編集できます。

詳細：[docs/canvas-architecture.md](docs/canvas-architecture.md) · Scene JSON：[docs/scene-json-spec.md](docs/scene-json-spec.md)。

キャンバス上でできること：

- フレーム、図形、テキスト、画像、動画、Lottie；ペン / 鉛筆（塗りつぶし輪郭のベクターブラシ）、選択と変形  
- **ブール演算**（和 / 差 / 積など）  
- **ストローク揃え**：中央 / **内側** / **外側**  
- **輪郭化**（ストローク → 編集可能な塗りパス）とパス編集  
- 塗り、角丸、ブレンド、不透明度、レイヤー；エクスポートと共有  
- **Yjs** リアルタイム共同編集（カーソル・選択・Undo；`apps/collab`）

## Design Agent

ストリーミング会話 Agent：要件を伝えると、同じキャンバス上で計画し、Skill を付け、ツールを呼び、結果を書き戻します——LP・ポスター・改稿など。

### レイヤー構成

実行カーネルは LangGraph テンプレート `canvas_ops_v1` で固定。品類と挙動は設定で変えます（AgentProfile YAML / プロンプトパック / Skills / Tools）。カーネル本体を触る必要はありません。

| 層 | 担当 | やってはいけないこと |
|----|------|----------------------|
| **Kernel** | 制御ループ、ツールスケジュール、キャンバス R/W、ラウンド / 権限 / ops 許可 | 審美や品類クラフト |
| **AgentProfile（YAML）** | 段階プロトコル、ルーティング、役割、サブエージェント、capabilities | LangGraph レジストリの代替 |
| **Stage プロンプトパック** | 段階ごとの turn プロトコル | 品類のクラフト教材 |
| **Skills** | ドメイン playbook（構図・リズム・レビュー基準・few-shot） | JSON 図元 / patch スキーマ変更 |
| **Tools** | 原子キャンバス操作（`create_frame`、`update_node`…） | ビジネス審美 |

典型フロー：`intent` →（雑談 settle / 軽改 `paint` / 設計 `decide`）→ `paint` が `tool_ops` を出す → `observe` → 任意の **Review** サブエージェント → settle。詳細は **[docs/agent-profile.md](docs/agent-profile.md)**。

### Skills

スキルごとに `apps/api/seeds/design_skills/<key>/`（`_meta.json` + `SKILL.md`；任意で `schema.json`、`assets/`）。

- **`_meta.json`** — いつ使うか、トリガー、`preferred_tools`、互斥 — Decide が選ぶ  
- **`SKILL.md`** — その成果物の作り方（LP / ポスター / 履歴書 / ダッシュボード / モーション……）

多数同梱（landing、poster、resume、dashboard、motion、ecommerce…）。フォルダを足せば拡張でき、上限はありません。

### Tools

原子操作は [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json)。Paint が構造化 `tool_ops` を出し、ホストが検証してキャンバスに適用。Skills は好みのツールを宣言できるが、登録外の op は不可。

### Agent をカスタムするとき触るファイル

| ファイル | 用途 |
|----------|------|
| [`apps/api/seeds/agents/profiles/design.canvas.yaml`](apps/api/seeds/agents/profiles/design.canvas.yaml) | **既定 Profile** |
| [`apps/api/seeds/agents/bindings.yaml`](apps/api/seeds/agents/bindings.yaml) | `product` / `surface` → Profile |
| [`apps/api/seeds/design_prompt_packs/`](apps/api/seeds/design_prompt_packs/) | 段階プロンプト本文 |
| [`apps/api/seeds/design_skills/`](apps/api/seeds/design_skills/) | スキル追加・編集 |
| [`apps/api/seeds/canvas_actions_seed.json`](apps/api/seeds/canvas_actions_seed.json) | ツールカタログ |
| `apps/api/.env` → `AGENT_PROFILE_ID` | Profile 強制指定（既定 `design.canvas`） |

**Agent を差し替える**

1. `profiles/design.canvas.yaml` をコピーして `id:` などを変更  
2. `bindings.yaml` を更新するか `AGENT_PROFILE_ID=…` を設定  
3. API を再起動（ディスクから読み込み、DB 行ではない）

**Skill を追加する**

1. `design_skills/my_scene/_meta.json` + `SKILL.md` を作成  
2. トリガーと `preferred_tools` を記入  
3. 再起動 / seed ensure 後、Decide がアタッチできる

追加の Skill パックは [`plugins/skills/`](plugins/skills/) にも置けます（Compose マウント済み）。[docs/skill-extensions.md](docs/skill-extensions.md)

Env： [docs/agent-profile.md § Env knobs](docs/agent-profile.md#env-knobs)。Seeds： [`apps/api/seeds/README.md`](apps/api/seeds/README.md)。モデル： [docs/self-hosting.md](docs/self-hosting.md)。

## プラグインと拡張

拡張面は 2 つ（混ぜないこと）：

| 種類 | パス | 拡張対象 | サンプル |
|------|------|----------|----------|
| **Skill パック** | [`plugins/skills/<key>/`](plugins/skills/) | Design Agent クラフト（`seeds/design_skills` と同レイアウト） | [`festival_poster`](plugins/skills/festival_poster/) |
| **Canvas プラグイン** | [`plugins/canvas/<id>/`](plugins/canvas/) | エディタ UI（現状：ボトムツールバー） | [`watermark`](plugins/canvas/watermark/) |

**Skill パック**

1. `plugins/skills/<key>/` に `_meta.json` + `SKILL.md`（任意で `handler.py` など）  
2. Compose は `./plugins/skills` をマウント済み。または `DESIGN_SKILLS_PLUGIN_DIRS`  
3. API 再起動 / ホットリロード — トリガーで会話（例：「中秋の赤いポスターを作って」）

任意：`DESIGN_SKILL_OPS_RUNNER=true` で `handler.py` が LLM paint 前に `tool_ops` を返せます。[docs/skill-extensions.md](docs/skill-extensions.md)

**Canvas プラグイン**

1. `plugins/canvas/<id>/` に `manifest.json` + `index.ts`  
2. `ensureCanvasPlugins()`（`apps/web/src/plugins/canvas/host.ts`）に登録  
3. Web を再ビルド / リロード  

[docs/canvas-plugins.md](docs/canvas-plugins.md)

**パッケージ化（`.recombyn-plugin`）**

```bash
node scripts/pack-recombyn-plugin.mjs plugins/skills/festival_poster
# → dist/plugins/<id>-<version>.recombyn-plugin
```

→ [docs/plugin-packs.md](docs/plugin-packs.md) · [plugins/skills/README.md](plugins/skills/README.md) · [plugins/canvas/README.md](plugins/canvas/README.md)

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
# ローカル — API sidecar + SQLite 同梱
npm run dev:desktop
npm run build:desktop:sidecar
npm run build:desktop

# クラウド — ブラウザと同じ本機 API（:8000 / .env）
# 公開デプロイ時は VITE_API_BASE_URL
npm run dev:desktop:cloud
npm run build:desktop:cloud
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
docs/              セルフホスト、Agent、プラグイン、デスクトップ、キャンバス
deploy/            Dockerfile / Nginx
e2e/               Playwright
```

ユーザー向けドキュメント：[recombyn.github.io/recombyn/](https://recombyn.github.io/recombyn/)（本リポジトリの `gh-pages` から公開）。

## ドキュメント / コミュニティ

| | |
|--|--|
| ユーザー向け | [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) |
| セルフホスト / 構成 | [docs/self-hosting.md](docs/self-hosting.md) |
| Skill 拡張 | [docs/skill-extensions.md](docs/skill-extensions.md) |
| Canvas プラグイン | [docs/canvas-plugins.md](docs/canvas-plugins.md) |
| プラグインパック（`.recombyn-plugin`） | [docs/plugin-packs.md](docs/plugin-packs.md) |
| AgentProfile | [docs/agent-profile.md](docs/agent-profile.md) |
| キャンバス | [docs/canvas-architecture.md](docs/canvas-architecture.md) |
| デスクトップ | [docs/desktop.md](docs/desktop.md) |
| Postgres | [docs/postgres-switch.md](docs/postgres-switch.md) |
| コントリビュート · セキュリティ · CoC | [CONTRIBUTING.md](CONTRIBUTING.md) · [SECURITY.md](SECURITY.md) · [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |

公式: [recombyn.com](https://recombyn.com) · Docs: [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/) · Source: [github.com/recombyn/zuoge](https://github.com/recombyn/zuoge)
