# Platform roadmap

Living checklist for zuoge. Phase 1 tooling is in flight ([PR](https://github.com/recombyn/zuoge/pull/104)).

## Principles

| Principle | Meaning |
|-----------|---------|
| **Standards first** | Commitlint / ADR / workspace tasks / gates |
| **One API** | Domain modules in `apps/api`; collab is its own WebSocket process |
| **Vertical slice** | Each async / observability / security item ships one production path, not a rewrite |
| **Self-host honesty** | High-availability cluster options stay *deploy choices*, not hard requirements for every install |

---

## Capability map

### 1. 仓库研发体系

| Capability | Status | Next |
|-----------|--------|------|
| Monorepo + shared configs | Done (P1) | Remote task cache when CI time hurts |
| Git 规范 + ADR | Done (P1) | Enforce ADR link in PR template |
| TDD / 分层测试 | Partial (unit + e2e + gates) | Coverage floor on **new** API routes |
| CODEOWNERS | Done (P2) | Keep owners current as teams grow |
| CI | Partial (Actions + web `tsc` in umbrella) | Remote cache when CI time hurts |
| 内外仓隔离 | N/A for now | Keep public OSS; secrets only in private env / desktop |

### 2. 架构形态

One FastAPI app with domain modules, plus the collab WebSocket process:

| Domain | Today |
|--------|-------|
| 网关 | API router + rate limit |
| 用户权限 | Auth + wallet flags |
| 画布存储 | Projects API + scene doc |
| 素材资产 | Uploads / object-storage hooks |
| AI 模型入口 | In-process façade (`get_llm_endpoint` / `build_chat_model`) |
| 异步任务 | Celery worker sharing the API codebase (hydrate / export / image) |
| 协同 | `apps/collab` WebSocket process |
| 扩展（Skill） | File packs: `skills/foundation|domains` + `plugins/skills` ([ADR 0013](../adr/0013-skill-extensions.md)) |
| 扩展（Canvas） | Toolbar plugins: `plugins/canvas` ([ADR 0014](../adr/0014-canvas-plugins.md)) |

→ See [ADR 0004](../adr/0004-modular-monolith-first.md).

### 3. 异步任务体系

| Capability | Status | Next (Phase 2) |
|-----------|--------|----------------|
| 消息队列 / 优先级 / 重试 / DLQ | Hydrate + export jobs / DLQ + admin replay; chat image/video/audio jobs | Priority queues / richer DLQ policy |
| AI / 导出 / 渲染异步 | Hydrate + artboard PNG export + chat image/video/audio jobs | — |
| 前端流式进度 | SSE / agent stream; hydrate `activity` + job poll `progress` (incl. video/audio) | Optional SSE for media jobs |

### 4. 存储分层隔离

| Capability | Status | Next |
|-----------|--------|------|
| 关系库 | MySQL（或 Postgres）via `DATABASE_URL` | Document HA as ops guide; shard only with metrics |
| 任务与协同缓存 | Job store + collab wait | Cache hot project meta; no premature cluster |
| 协同日志独立 | Collab room vs project DB | ADR when splitting durable collab persistence |
| 对象存储 | S3-style hooks | Default path for uploads in prod compose |
| 向量库检索 | Optional memory extra | Keep optional; not core path |
| 配置中心 | env / Settings | Stay env-based until multi-cluster |

### 5. 可观测运维

| Capability | Status | Next (Phase 3) |
|-----------|--------|----------------|
| 可选全链路追踪 | API + worker + optional collab (ADR 0011) | Collector dashboards |
| 结构化日志 | `LOG_JSON` + redaction | Keep human default locally |
| 指标 | `/metrics` + hydrate/DLQ depth panels + compose `obs` | Remote cache / multi-cluster |
| 自动告警 | Rules + compose alert receiver (no-op; webhook override) | Production contact points |

### 6. 部署环境

| Capability | Status | Next (Phase 4+) |
|-----------|--------|-----------------|
| 集群清单 | Starter manifests + HPA/Ingress/PDB/NetworkPolicy (ADR 0012) | Multi-AZ when operated |
| 扩缩容 / 灰度 / 回滚 | Manual + GHCR tags | Image tag + rollback runbook first |
| 混沌工程 | No | Only after async + obs baselines |

### 7. 安全与商业化基建

| Capability | Status | Next |
|-----------|--------|------|
| 细粒度 RBAC | org invite email (best-effort) + pending accept + project org move | Dedicated invite email template |
| 文件查杀 / 内容安全 | Magic sniff + `docker-compose.av.yml` | Tune scan timeout / fail-open policy |
| 限流防刷 | Per-route rate limits | Tune; abuse playbooks |
| 配额 / 计费 | Wallet + holds exist | Turn on carefully; audit ledger |
| 脱敏 / 安全审计 | Log redaction + admin write audit (router-wide) | Product audit log UI |

---

## Execution phases

### Phase 1 — Foundation

- [x] Workspace task runner, `@repo/tsconfig`, `@repo/eslint-config`
- [x] husky + commitlint
- [x] `docs/adr` + seed ADRs
- [x] `npm run dev:stack`
- [x] Full web `tsc` clean (`npm run typecheck:web`)
- [x] `CODEOWNERS` + PR template (ADR checkbox)

### Phase 2 — Backend productionization (async + AI platform)

- [x] ADR: async job boundary (priority deferred; poll contract; job store + worker) — [0005](../adr/0005-async-job-boundary.md)
- [x] First vertical async job: `POST/GET /api/v1/design/hydrate/jobs` + `run_image_hydrate_job`
- [x] `npm run dev:worker` (+ CODEOWNERS / PR template)
- [x] Wire hydrate job into Design Agent apply/action (`hydrate_tool_ops_images` → worker, stall fallback)
- [x] LLM adapter ADR + thin façade (model 中台 **in-process** first) — [0006](../adr/0006-llm-facade-memory-tiers.md)
- [x] Memory tiers documented (session / project / global → `agent_memory`) — same ADR
- [x] Alembic single-head CI gate (`test_alembic_single_head`)
- [x] Coverage floor on hydrate jobs route (`--cov-fail-under=95`)
- [x] Worker transient retry + `recombyn_hydrate_jobs_total` metrics + hydrate DLQ

### Phase 3 — Observability & security

- [x] Correlation + structured logs (ADR 0007; `trace_id` on hydrate API→worker; `LOG_JSON`)
- [x] Hydrate failure alert (+ existing RED / dep rules)
- [x] Dependency audit CI (pip-audit + npm audit, soft gate)
- [x] Upload hardening (MIME magic sniff + optional AV hook) — [0008](../adr/0008-upload-content-validation.md)
- [x] RBAC notes + security process docs — [security-rbac.md](../security-rbac.md)
- [x] Optional tracing SDK — [0011](../adr/0011-opentelemetry-optional.md) (`pip install -e '.[otel]'`)
- [x] Compose AV profile (`docker compose --profile av`)

### Phase 4 — CI/CD & deploy options

- [x] Unified CI umbrella (`ci.yml`: lint → contracts typecheck → unit → web build) — [0009](../adr/0009-unified-ci-rollback.md)
- [x] CHANGELOG + semver tagging convention; Compose rollback runbook
- [x] GHCR / image publish workflow on tags (`release-docker.yml` + `docker-compose.ghcr.yml`)
- [x] Desktop signing docs + unsigned `desktop-build.yml` (dispatch) — [0010](../adr/0010-desktop-signing.md)
- [x] Cluster manifests deferred (compose/GHCR default) — `deploy/k8s/README.md`
- [x] Require `typecheck:web` in umbrella CI + `npm run ci:gate` (Phase 1 tsc debt cleared)

### Phase 5 — Stress

- [x] Baseline runbook for collab/canvas/load/agent stress — [stress-baselines.md](../stress-baselines.md)
- [x] Mock paid-gen finish E2E (`canvas.generators` route mock) + project `baseRevision` 412 conflict (functional API + `collab.sync`)
- [x] Dual-client collab merge under concurrent writes (`apps/collab/dual_client_merge.test.mjs` + Gate B CI)

### Phase 6 — Operator & scale follow-through

- [x] Worker + collab tracing (same enable env as API) — ADR 0011
- [x] Cluster starter manifests — [0012](../adr/0012-k8s-starter-manifests.md) / `deploy/k8s/`
- [x] Resource×action RBAC helpers + admin audit (`require_permission`, `PATCH /admin/users`)
- [x] 5k-node interactive canvas-ink budget Vitest (`canvas5k.interactiveBudget`)
- [x] Opt-in paid image gen E2E (`E2E_PAID_IMAGE_GEN=1`)
- [x] Hydrate DLQ alert
- [x] Cluster HPA + Ingress examples (`deploy/k8s/hpa.yaml`, `ingress.yaml`)
- [x] Admin write audit on all `/admin/**` mutating routes (`audit_admin_writes`)
- [x] Org membership skeleton (`orgs` / `org_members` + permission helpers)
- [x] `projects.org_id` + org invite API (`POST/GET /orgs`, members invite)
- [x] Cluster PDB + NetworkPolicy (`deploy/k8s/pdb.yaml`, `networkpolicy.yaml`)
- [x] Web account org tab (create / invite / preferred org) + mine org filter
- [x] Org pending invites (search users, accept/decline) + `org_invites` Alembic
- [x] Project org badge/move + org rename / remove member
- [x] Org invite email notify (best-effort; response `emailSent`)
- [x] Hydrate DLQ admin replay (`GET/POST/DELETE /admin/ops/hydrate-dlq`) + depth gauge
- [x] Compose `obs` profile + DLQ dashboard panels
- [x] AV prod overlay (`docker-compose.av.yml` + `INSTALL_AV`)
- [x] Admin Insights hydrate DLQ tab (list / replay / discard)
- [x] Async artboard export jobs (`POST/GET /design/export/jobs` + `/file`, PNG with scene text)
- [x] Export DLQ admin replay (`GET/POST/DELETE /admin/ops/export-dlq`) + depth gauge / Insights tab
- [x] Chat image gen jobs (`POST/GET /chat/image/jobs`) — editor polls; sync `POST /chat/image` kept for scripts
- [x] Hydrate job progress on Design Agent SSE (`activity` + `task_id`)
- [x] Skill extensions Phase A — `plugins/skills` mount, `_meta.json` / `skill_key`, sample `festival_poster` ([ADR 0013](../adr/0013-skill-extensions.md))

### Phase 7 — Extensibility (plugins)

- [x] Skill playbook packs + private mount (`plugins/skills`) — ADR 0013
- [x] Canvas toolbar registry (TS, in-process) + sample watermark — ADR 0014
- [x] Optional skill ops runner (`handler.py` → `tool_ops`) — ADR 0015
- [x] Packaged install (`.recombyn-plugin`) + optional HMAC — ADR 0016
- [x] Video/audio async jobs (off-request, mirror chat image jobs) — ADR 0005