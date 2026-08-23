# AgentProfile & forked sub-agents

内置 Design Agent 的产品行为（阶段协议、路由、角色、子代理）由 YAML Profile 驱动。执行内核仍是 LangGraph `canvas_ops_v1`——你可以换 Profile / Skill / 提示词包，不用改内核。

相关：自托管 [self-hosting.md](./self-hosting.md) · 种子目录 [apps/api/seeds/README.md](../apps/api/seeds/README.md) · bindings [agents/README.md](../apps/api/seeds/agents/README.md)

## Goals / non-goals

| | |
|--|--|
| **Goal** | Kernel 固定；换人格 = 换 Profile（Voice / Surface / Policy / Topology 模板 / Contracts / 子代理目录） |
| **Non-goal** | Admin 流程图 JSON 当 live executor；用「更大的 system prompt」当全域配置 |
| **Live ≠ Admin** | Admin flow 可视化 / dry-run 不等于 `graph/build.py` 注册表里的 template |

## Files

| Path | Role |
|------|------|
| `apps/api/seeds/agents/bindings.yaml` | `product` / `surface` → Profile id（默认 `design.canvas`） |
| `apps/api/seeds/agents/profiles/design.canvas.yaml` | Live Design Agent Profile |
| `app/services/design/runtime/agent_profile.py` | Load / validate / contracts / tool host / `$kv` |
| `app/services/design/runtime/subagent.py` | Forked spawn + catalog + Redis job results |
| `app/services/design/runtime/host/resources.py` | Deferred `need_tools` / `need_skills` / `need_subagents` |
| `app/services/design/runtime/graph/nodes/review.py` | Review Agent（forked） |
| `app/services/design/runtime/graph/build.py` | Template registry (`canvas_ops_v1`) + review 边 |

## Resolve which Profile

Priority（`resolve_profile_id`）：

1. **显式** `profile_id`（调用方传入）
2. **环境 / settings** `AGENT_PROFILE_ID`（默认 `design.canvas`；设空串则跳过此层走 bindings）
3. **`bindings.yaml`**：按 `when.product` / `when.surface` 首条匹配
4. **`bindings.default`**（缺省仍回落 `design.canvas`）

```yaml
# seeds/agents/bindings.yaml
default: design.canvas
bindings:
  - id: editor-design
    when: { product: canvas, surface: editor }
    profile: design.canvas
```

## Profile shape (`design.canvas`)

```yaml
apiVersion: recombyn.agent/v1
kind: AgentProfile
id: design.canvas
identity.prompts.stages:   # stage → prompt pack kind
topology.template: canvas_ops_v1
topology.stages_enabled: [intent, decide, paint, observe, review]
topology.loops:            # e.g. review must_fix → paint max: 2
roles:                     # primary shared_state + specialist forked_context
subagents:                 # spawn catalog (forked specialists)
contracts:                 # stage → Pydantic schema id
capabilities:              # tools / skills catalogs
routing / runtime:         # $kv: overlays onto Admin KV rules
```

| Block | Owns |
|-------|------|
| `identity.prompts` | Voice：persona / overlays / 每 stage 的 pack kind |
| `topology` | 选哪个 LangGraph template、哪些 stage 进图、retry loops |
| `roles` | primary vs specialists；谁 `shared_state` / `forked_context` |
| `subagents` | Decide `need_subagents` 目录 + graph fork 定义 |
| `contracts` | stage → schema id（如 `DecideTurn.v1`） |
| `capabilities` | tools / skills catalog、defer、namespaces |
| `routing` / `runtime` | 模型 lane、flags、memory/attach 限额 |

- **`$kv:ruleKey`**：从 Admin KV 拷贝到该字段；**字面量**覆盖 KV
- **`topology.template`** 必须是 live 注册表里的 builder（当前仅 `canvas_ops_v1`）
- 看图 / 综合 `design_brief` 属于 Decide（设计过程），不单独占 scout 子代理

### Sub-agent entry fields

```yaml
subagents:
  review:
    description: "…"          # catalog 文案
    isolation: forked_context # spawn / graph fork 语义
    model: $kv:agent.review.model
    stage: review             # → prompts.stages + contracts
    system: agent.prompt.review_system
    contract: ReviewTurn.v1
    tools: []                 # 预留；当前 fork 多为 structured turn
    max_turns: 1
    parallel: false
```

## Live graph (`canvas_ops_v1`)

```text
START → bootstrap
          ├─ apply_ops? → apply_confirm → observe → …
          └─ memory → intent_classify
                           ├─ chat → settle
                           ├─ canvas_op → paint_ops          # lean edits; no Decide brief
                           └─ design → design_agent (decide)
                                  ├─ chat / ask → settle
                                  └─ design_brief → paint_ops
                                         ├─ Ask → propose → settle
                                         └─ Agent → action → observe
                                                ├─ structural critique fail → paint_ops
                                                ├─ Review auto gate? → review (fork)
                                                │      ├─ must_fix + budget → paint_ops
                                                │      └─ pass / exhausted → settle
                                                └─ else → settle   # clean first paints skip Review
```

| Node | Isolation | Notes |
|------|-----------|--------|
| `design_agent` | shared | Decide: `need_*` then **design_brief**; no canvas ops |
| `paint_ops` | shared | Structured `tool_ops`; executes DESIGN_BRIEF |
| `observe` | shared | FE `interrupt` + deterministic structure critique only |
| `review` | **forked** | Craft gate. Default Profile `review_mode=auto`; **user `design_intensity` overrides** (see below) |
| `propose` / `action` / settle | shared | Ask hold / emit ops / finish. Ask chips persist as `choice_ui` only (SSE + chat meta). |

### Observe ↔ scene feedback (do not infinite-repaint)

After `action` emits `tool_ops`, the graph **interrupts** until the frontend POSTs a real canvas snapshot (`POST /api/v1/design/run/{task_id}/scene`). Observe’s inventory / `op_results` / spatial hints come from that POST — not from a server-side apply.

```text
paint_ops → action (tool_ops + scene_feedback_request)
         → FE apply + wait inventory settle → POST scene
         → observe
              ├─ timeout (no POST)     → settle (assume applied; no critique→paint)
              ├─ op_results all fail   → paint_ops if reflect_left
              ├─ structure critique    → paint_ops if reflect_left (capped)
              ├─ Review auto gate?     → review …
              └─ else                  → settle
```

| Guard | Behavior |
|-------|----------|
| Scene wait | ~12s; timeout → **settle**, do **not** critique stale/empty inventory into a re-paint |
| Round latch | Stale FE POSTs for a previous wait round are ignored |
| Create vs empty | If FE `op_results` mark creates **ok** but nodes are still empty → treat as sync lag (no empty-board re-paint) |
| FE settle | After paint, FE waits until scene inventory fingerprint is stable (~2 frames / ≤480ms) before POST |
| Reflect / Review | `reflect_left` / `review_left` cap retries (not unbounded) |

#### Artboard vs viewport (placement)

| Term | Meaning |
|------|---------|
| **Artboard** | A fixed design plate (`frames[]`: x/y/w/h). Does not move when the user pans/zooms. |
| **Viewport** | The camera window currently visible on screen (`spatial_summary.viewport`). Changes with pan/zoom and can lag behind Yjs/Redux. |

- **Pre-apply paint gate**: placement prefers **artboard** bounds when a focus frame exists; falls back to viewport with a looser pad.
- **Post-paint observe**: does **not** re-check “outside viewport” (camera lag caused false re-paints). Observe still flags **stacked creates** and empty-board structure when FE truth says ops failed or inventory is empty without successful create results.

UX tip codes: `observe_scene_timeout`, `observe_ops_failed`, `observe_critique_failed` (FE i18n via `designAgentEventRouter`).

### Env knobs

| Key | Default | Notes |
|-----|---------|--------|
| `AGENT_PROFILE_ID` | `design.canvas` | Active Profile id（见上） |
| `DESIGN_REVIEW_AGENT_ENABLED` | true | Off → never run LLM Review |
| `DESIGN_REVIEW_MODE` | `auto` | Fallback when the run has no `design_intensity`. `auto` / `off` / `always`. Profile `runtime.flags.review_mode` / KV `design.review.mode` |
| `DESIGN_CRITIQUE_ENABLED` | true | Structural critique in observe (cheap; not taste) |
| `DESIGN_GRAPH_NODE_TIMEOUT_SEC` | 180 | Per-node timeout |
| `DESIGN_GRAPH_RETRY_ATTEMPTS` | 3 | 通用节点；**review / observe 固定 `max_attempts=1`**（避免 3×180s 挂死） |

**Review auto gates** (when mode=`auto`): structure signals with no reflect budget, paint retry flags, taste-complaint prompt, or narrow high-stakes (ref images + design / multi-artboard). Clean design first paints → Observe → settle.

### Run request: locale + design intensity

`POST /api/v1/design/run` body fields (FE: `runDesignAgent` / localStorage `recombyn.designIntensity.v1`). These are **pipeline knobs**, not “pick a more expensive model”.

#### `locale` (output language)

Supported: `zh-CN` | `zh-TW` | `en` | `ja`. Resolve order (`resolve_output_locale`):

1. Client `locale` (UI language)
2. Cheap script hint from the user prompt (CJK → `zh-CN`)
3. AgentProfile `identity.locale`
4. Default `zh-CN`

Every stage system prompt gets `language_directive`: user-facing prose follows `output_language`; tool schemas / op names / hex stay as-is.

#### `design_intensity` (pipeline depth)

| Value | Review | Strategy stack (research → candidates → …) | `review_left` floor |
|-------|--------|--------------------------------------------|---------------------|
| `light` (极速) | `off` | Skip | Profile default |
| `medium` (中, default) | `auto` | Run | Profile default |
| `high` (高) | `always` | Run | ≥ 2 |
| `extreme` (极高) | `always` | Run | ≥ 3 |

User intensity **overrides** Profile / `DESIGN_REVIEW_MODE` for that run (`rt.flags.review_mode` / `review_left`). Higher intensity burns more review rounds (and quota), not a different model SKU.

UX tips on failure / apply / Ask dismiss use `_emit_ux_tip` (`token.code` + English fallback); FE maps codes via i18n — do not add new UX LLM calls on those paths.

### Stress / regression

Eval seed: [`apps/api/seeds/design_agent_eval_suite.json`](../apps/api/seeds/design_agent_eval_suite.json) (not ingested by the live graph). Runner: `npm run eval:agent` → [`eval/design-agent/run.mjs`](../eval/design-agent/run.mjs). System failures → prompt packs; craft failures → skills. Load gates: [`docs/quality-gates.md`](./quality-gates.md).

Review 重试预算：`rt.flags.review_left` ← Profile `topology.loops`（`from: review` / `when: must_fix` / `to: paint` 的 `max`），再被 `design_intensity` 抬高（high ≥ 2，extreme ≥ 3）。

Review 选模：用户锁模 / `single_model` → 同一模型（不强制看图专用模）；无预览或非 vision 时用 **DESIGN_BRIEF + SCENE** 文本对照。Auto 时可跟本轮 Design 模型或 Admin `agent.review.model`。

## Decide resources (`need_*`)

Decide 协议 pack：`agent.prompt.need_tools_overlay`。

| Field | Host action |
|-------|-------------|
| `need_tools` | Inject `TOOL_DETAILS` |
| `need_skills` | Inject `SKILL_DETAILS`（+ auto skill triggers） |
| `need_subagents` | Spawn Profile catalog children → `SUBAGENT_RESULTS` |

`need_subagents` 形状（少用；看图 / brief 综合是 Decide 的事）：

```json
[{"id":"review","task":"…","background":false}]
[{"job_id":"abc123"}]
```

- **同步**：await fork，结果进 `pending_subagent_details`，下一轮用 `agent.prompt.pending_subagents` 回注
- **background**：立刻返回 `job_id`；结果写**本进程内存** + Redis `design:subagent_job:*`（TTL 1h）；下轮 harvest / `{"job_id":…}` poll

### Auto-triggers

**无**自动 spawn vision_scout / research。参考图由 Decide 自己看，并写入 `design_brief`。

## Sub-agent catalog (shipped)

| Id | Contract | When |
|----|----------|------|
| `review` | `ReviewTurn.v1` | Optional stage after observe（`review_mode=auto|off|always`） |

Fork 语义：

- **新消息列表**：system + 本轮 task（可带图）
- **不带**父 Agent 聊天 transcript
- 进程内 async（**不是** OS 子进程）；`parallel: true` 可 `gather`

新增子代理步骤：

1. Profile `subagents.<id>` + `contracts.<stage>`（若 stage 独有）
2. Pack `agent.prompt.<…>_system.md` + `_index.json`
3. Pydantic schema 注册进 `ensure_contract_registry()`
4. （可选）Decide 显式 `need_subagents` — 默认不要为「看图/调研」再加 scout
5. 若要占图节点：写进 `topology.stages_enabled` + `build.py` 边（如 `review`）

## Prompt packs（子代理相关）

| Kind | Role |
|------|------|
| `agent.prompt.need_tools_overlay` | Decide 资源协议（含可选 `need_subagents`） |
| `agent.prompt.review_system` | Review |
| `agent.prompt.pending_subagents` | 结果回注一句（若有） |

Boot：`ensure_design_prompt_packs` **以 git seed 为准** upsert（body / title / used_by / when / scenes / pack_type / sort_order）。改 `stages/*.md` 或 `snippets.md` 后重启 API（或再跑 ensure）即进 DB；Admin UI 改文案下次 ensure 会被 seed 覆盖。

## Limits / caveats

- Background spawn 结果靠 **同进程 async + Redis 结果仓**；跨 worker 只共享结果，不保证「谁起的任务」在另一 worker 上继续跑。
- 当前仅一个 live template：`canvas_ops_v1`。新拓扑 = 新 builder 注册，不是 Admin 自由连线。
- FE 对 Review / subagent SSE 的专用表面可能仍在演进；协议以运行时 emit 为准。
- OpenAPI / `packages/contracts` 若仍广告已删路由，需重新 `gen` 后对齐。

## Local smoke / E2E

```bash
# API（WatchFiles 重载偶发挂掉时重启）
npm run dev:api
```

Create 路径：Decide（带图则自己看）→ `design_brief` → Paint → Observe →（Review **auto 门控**，多数回合直接 settle）。

单元：`apps/api/tests/unit_tests/test_agent_profile.py` · `test_subagent_spawn.py` · `test_design_critique.py` · `apps/api/tests/design_engine/test_language_and_reply.py`

## Code map

```text
bindings.yaml ──► resolve_profile_id
profile YAML  ──► AgentProfile
                    ├─ assemble_stage_system (Voice)
                    ├─ apply_profile_rules   (Policy $kv)
                    ├─ roles / subagents
                    └─ contracts → structured LLM

decide ── need_* ──► host/resources.load_deferred_resources
                      ├─ tools / skills
                      └─ subagent.run_subagent(s) / background+Redis

observe ──► structure critique ──► [Review auto?] review (fork) | settle
```
