# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
for tagged releases (`vMAJOR.MINOR.PATCH`).

## [Unreleased]

### Removed

- Artboard **export** is PNG-only (non-PNG formats rejected)
- File **import** is image-only (document convert paths removed)

### Added

- Phase 1–3 foundation: monorepo / ADR / async hydrate jobs / LLM façade / correlation logs / upload magic sniff
- Unified CI umbrella (`.github/workflows/ci.yml`) — lint, contracts typecheck, **web `tsc`**, unit tests, web build (ADR 0009)
- GHCR publish on `v*.*.*` tags (`release-docker.yml`) + `docker-compose.ghcr.yml` pull path
- Desktop unsigned CI build (dispatch) + signing checklist (ADR 0010); stress baseline runbook
- Mock image-gen promote E2E + project `baseRevision` 412 conflict coverage (Phase 5 slice)
- Optional OpenTelemetry (`.[otel]`, ADR 0011); hydrate Redis DLQ; ClamAV compose profile; dual Yjs merge Gate B
- Phase 6: k8s starter manifests, worker/collab OTel, RBAC permissions, 5k LOD budget test, paid-gen opt-in E2E
- k8s HPA/Ingress examples; admin write audit router-wide; org_members Alembic skeleton
- `projects.org_id` + org invite API; k8s PDB + NetworkPolicy starter manifests
- Account **Organization** tab (create / invite / preferred org) + Projects org filter; contracts regen for `/orgs`
- Org **pending invites** (user search, accept/decline) + Alembic `0008_org_invites`
- Project org badge / move-to-org; org rename + remove member APIs
- Org invite **email notify** (Tencent SES best-effort; response `emailSent`)
- Admin hydrate **DLQ replay** (`/api/v1/admin/ops/hydrate-dlq`) + `recombyn_hydrate_dlq_depth`
- Compose **obs** profile (Prometheus / Grafana / Alertmanager) and **av** overlay (`clamdscan`)
- Admin Insights **失败队列** tab (hydrate DLQ list / replay / discard)
- Async **artboard export** jobs (`POST/GET /api/v1/design/export/jobs`, PNG via Celery)
- Admin **export DLQ** replay (`/api/v1/admin/ops/export-dlq`) + `recombyn_export_dlq_depth`
- Async **chat image** jobs (`POST/GET /api/v1/chat/image/jobs`) so editor generate does not hold API workers
- Async **chat video/audio** jobs (`POST/GET /api/v1/chat/video/jobs`, `/chat/audio/jobs`) — same poll contract as image (ADR 0005)
- Design Agent hydrate **progress** on the existing SSE (`activity` + `task_id`)
- Skill **extensions** Phase A: two roots (`seeds/design_skills` + `plugins/skills`), canonical pack layout (`schema.json` / `assets/` / reserved `handler.py`), meta aliases, sample `festival_poster` (ADR 0013)
- Canvas **plugins** Phase B: `plugins/canvas` host + toolbar registry + sample `watermark` (ADR 0014)
- Skill **ops runner** Phase C: opt-in `handler.py` → `tool_ops` before LLM paint (subprocess + validate), sample `festival_poster` (ADR 0015)
- Plugin **packs** Phase D: `.recombyn-plugin` format + install API + optional HMAC; Skills library accepts `.recombyn-plugin` (ADR 0016)

### Changed

- Self-host docs: Docker Compose image tag rollback procedure
- Cleared Phase 1 web `tsc` debt; `npm run typecheck:web` required in CI / `ci:gate`
- Perf k6 collab install uses `--ignore-scripts` (husky prepare no longer breaks Gate B)
- Hydrate DLQ push is best-effort (no Redis required in unit tests)

## [0.1.0] — 2026-08-12

### Added

- Initial public monorepo baseline (web, API, collab, quality gates)
