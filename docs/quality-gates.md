# Quality gates

You can run the same Pytest / Playwright / k6 / Prometheus checks locally that CI uses. Monorepo conventions: [`docs/roadmap/platform.md`](./roadmap/platform.md) · [`docs/adr/`](./adr/README.md).

## Quick commands

| Command | Purpose |
|---------|---------|
| `npm run check` | Web ESLint + contracts `tsc` |
| `npm run ci:gate` | Local mirror of CI umbrella (check + web unit + API unit) |
| `npm run lint` / `typecheck` | Workspace lint / contracts typecheck |
| `npm run dev:stack` | Vite web + collab WS together |
| `npm run dev:api` / `dev:worker` | API + background worker (hydrate/import jobs) |
| `npm run test:gate:a` | Gate A quality script |
| `npm run test:canvas:stress` | Canvas store + E2E stress matrix |
| Stress baseline notes | [`docs/stress-baselines.md`](./stress-baselines.md) |

Two gates, one metrics truth. Local full matrix: **`npm run test:gate:full`** (or `test:gate` / `test:gate:a` / `test:gate:b`).

## Gate A — Correctness

| Tool | Role | Command |
|------|------|---------|
| **Pytest** | API contracts | `npm run test:api` (uses `apps/api/.venv` when present) |
| **Functional API** | All product HTTP surfaces | `npm run test:functional:api` |
| **Functional UI** | All major routed shells | `npm run test:functional:e2e` |
| **Playwright** | UI / collab / surface + full shells | `npm run test:e2e` |
| **Vitest** | Pure canvas/geometry | `npm run test:web` |
| **Agent concurrency** | Design craft + system cases under load | `npm run test:agent:concurrency` (+ `--system`) |
| **Eval** | Design Agent craft (40 V3 tasks) | `npm run eval:agent -- --v3-tasks` then `npm run eval:compare` |

```bash
# Prefer 127.0.0.1 (Vite binds host 127.0.0.1). Token optional for smoke; required for journeys.
E2E_BASE_URL=http://127.0.0.1:3000 npm run test:gate:a
# Full product surface smokes (API + UI shells):
npm run test:functional
# With token + live API: includes agent stress when using test:gate / test:gate:full
npm run test:gate
```

### Functional coverage matrix

`test:functional` hits every major product surface at smoke depth:

| Surface | API suite | E2E shell |
|---------|-----------|-----------|
| Health / metrics | ✓ | — |
| Auth (config/me/captcha) | ✓ | login route |
| Wallet / BYOK / liked | ✓ | account tabs (profile/agent/usage) |
| Projects CRUD + collab token | ✓ | mine + editor |
| Shares | ✓ | `/s/:id` |
| Plaza feed/mine | ✓ | inspiration tabs |
| Design catalog/tools/skills | ✓ | skills nav |
| Chat models/tools/sessions | ✓ | — |
| Image tools / import validation | ✓ | — |
| Admin (users/plaza/fonts/…) | ✓ | — |
| Notices / fonts / assets / users search | ✓ | account/home |

Canvas Image/Video/Audio/Animation generator plates + text tool (browser): `npm run test:canvas:generators` (`e2e/tests/canvas.generators.spec.ts`). Includes **mocked** `/chat/image` promote (no provider keys). Store spawn/finish covered by Vitest `canvasGenerators.store` + `quickEditGenPromptEcho.stress`.

Full canvas stress matrix (store + RCB + foundations/generators + product E2E): `npm run test:canvas:stress`. Product-only E2E (ops, upload/mark, tools, density): `npm run test:canvas:product`.

Project optimistic lock (`baseRevision` → 412 `project_revision_conflict`): functional API suite + `e2e/tests/collab.sync.spec.ts`. Dual-client Yjs concurrent merge: `npm run test:collab:merge` / Gate B. Real provider paid gen, OCR worker, and OAuth/OTP remain later Gate A journeys.

CI mints `E2E_TOKEN` via `scripts/ci-mint-token.mjs` (`SUPER_ADMIN_TEST_CODE`, **max 8 chars**).
Collab dual-WS: set `E2E_COLLAB_WS` (CI sets this). Category eval: `E2E_EVAL=1`.
E2E workers default to **2** (`E2E_WORKERS` to override) to avoid auth rate-limit flake.

## Gate B — Performance & stability

| Tool | Role | Command |
|------|------|---------|
| **k6** | Load | `npm run perf:k6:smoke` / `perf:k6:api` / `perf:k6:soak` (soak = smoke + `K6_SOAK=1`) / `perf:k6:collab` |
| **Prometheus** | Scrapes `/metrics` + alert rules | compose `:9090` |
| **Grafana** | SLO dashboards | compose `:3001` (admin / recombyn) |

```bash
docker compose --profile obs up -d api prometheus grafana alertmanager
# Heavy load: restart API with RATE_LIMIT_ENABLED=false
curl -s http://127.0.0.1:8000/metrics | head

SUPER_ADMIN_TEST_CODE=… npm run ci:mint-token
npm run test:gate:b
# or:
npm run perf:k6:smoke
PERF_TOKEN="$(cat .tmp-token.txt)" npm run perf:k6:api
COLLAB_WS_URL=ws://127.0.0.1:1234 npm run perf:k6:collab
```

### Alert rules

`deploy/observability/prometheus/rules/recombyn.yml`:

- 5xx rate > 5% (5m)
- p95 latency > 2s (10m)
- DB / Redis gauge down (2m)
- Hydrate job failure rate > 25% (10m)
- Hydrate DLQ pushes > 5 / 30m
- Hydrate DLQ depth > 20 (10m)

View in Prometheus **Alerts**. Alertmanager listens on `:9093` (compose profile `obs`). Override `deploy/observability/alertmanager/alertmanager.yml` webhook locally (do not commit secrets).

### CI workflows

| Workflow | When |
|----------|------|
| **`ci.yml`** (umbrella) | Every PR / main — `check` + web unit + API unit + web build → **`CI / gate`** |
| `release-docker.yml` | `v*.*.*` tags / dispatch — push api/web/collab to GHCR |
| `desktop-build.yml` | Dispatch — unsigned Windows Tauri bundle (ADR 0010) |
| `e2e-tests.yml` | Path-filtered — Playwright |
| `perf-k6.yml` | Path-filtered / dispatch — k6 smoke |
| `dependency-audit.yml` | Lockfile PRs + weekly — soft audit |
| `nightly-quality.yml` | Nightly — eval shape + skill compare + soak |
| `skill-regression.yml` | Skill / eval path changes — 40-task dataset + compare (avg drop > 3 or key task drop > 5 → fail) |
| `block-cursor-coauthor.yml` | All PRs — reject Cursor co-author trailer |

Branch protection should require **`CI / gate`**. Full web `tsc` is intentionally **not** in the gate yet (tracked Phase 1 debt). Rollback: [self-hosting.md § Rollback](./self-hosting.md#rollback-docker-compose).

## Layout

| Path | Purpose |
|------|---------|
| `scripts/run-quality-gate.mjs` | Unified Gate A/B runner |
| `scripts/functional-api-suite.mjs` | Full HTTP surface functional suite |
| `perf/k6/` | Gate B scenarios |
| `eval/design-agent/` | Design Agent quality suite (`rubric.json` = Runtime Review caps) · see [ADR 0023](./adr/0023-public-private-eval.md) |
| `packages/eval-framework` | Compare helpers for the in-tree suite |
| `deploy/observability/` | Prometheus + Grafana |
| `scripts/ci-mint-token.mjs` | CI/local session mint |
| `apps/api/seeds/design_agent_eval_suite.json` | Eval cases |
| `e2e/tests/surfaces.smoke.spec.ts` | Auth / home / projects / me / editor smokes |
| `e2e/tests/functional.all.spec.ts` | All major UI shells (home navs, account, plaza, editor, share) |

## Design Agent observe / placement

See [agent-profile.md — Observe ↔ scene feedback](./agent-profile.md#observe--scene-feedback-do-not-infinite-repaint) for artboard vs viewport and anti-repaint guards.
