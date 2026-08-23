# Architecture Decision Records (ADR)

Cross-cutting or hard-to-undo technical choices live here. Product how-tos stay in `docs/*.md`.

## When to write an ADR

- New shared package / monorepo boundary change
- Persistence or collab protocol change (DB, Yjs, Redis)
- Async job / LLM provider abstraction
- Security model (authz, secrets, upload)
- Anything that would surprise a new engineer six months later

## Process

1. Copy [`0000-template.md`](./0000-template.md) → `NNNN-short-slug.md` (next number).
2. Open a PR with the ADR **before or with** the implementing code.
3. Status: `Proposed` → `Accepted` (on merge) → `Superseded by NNNN` if replaced.

## Index

| ID | Title | Status |
|----|-------|--------|
| [0001](./0001-monorepo-boundaries.md) | Monorepo app/package boundaries | Accepted |
| [0002](./0002-canvas-rcb-runtime.md) | Custom RCB canvas runtime | Accepted |
| [0003](./0003-yjs-collab-service.md) | Yjs collab as a separate Node service | Accepted |
| [0004](./0004-modular-monolith-first.md) | One API, domain modules | Accepted |
| [0005](./0005-async-job-boundary.md) | Async job boundary (Celery + Redis poll) | Accepted |
| [0006](./0006-llm-facade-memory-tiers.md) | In-process LLM 中台 + memory tiers | Accepted |
| [0007](./0007-correlation-structured-logs.md) | Correlation + structured logs | Accepted |
| [0008](./0008-upload-content-validation.md) | Upload content validation + optional AV | Accepted |
| [0009](./0009-unified-ci-rollback.md) | Unified CI gate + Docker tag rollback | Accepted |
| [0010](./0010-desktop-signing.md) | Desktop (Tauri) release signing | Accepted |
| [0011](./0011-opentelemetry-optional.md) | Optional OpenTelemetry SDK | Accepted |
| [0012](./0012-k8s-starter-manifests.md) | Optional Kubernetes starter manifests | Accepted |
| [0013](./0013-skill-extensions.md) | Skill extension packs (Phase A plugins) | Accepted |
| [0014](./0014-canvas-plugins.md) | Canvas toolbar plugins (Phase B) | Accepted |
| [0015](./0015-skill-ops-runner.md) | Skill `handler.py` ops runner (Phase C) | Accepted |
| [0016](./0016-recombyn-plugin-pack.md) | `.recombyn-plugin` pack install (Phase D) | Accepted |
| [0017](./0017-intelligence-provider-boundary.md) | Design Intelligence provider boundary | Accepted |
| [0018](./0018-public-skills-catalog.md) | Public skills catalog layout | Accepted |
| [0019](./0019-open-skill-sdk.md) | Open skill-sdk package | Accepted |
| [0020](./0020-open-plugin-sdk.md) | Open plugin-sdk package | Accepted |
| [0021](./0021-open-agent-sdk.md) | Open agent-sdk package | Accepted |
| [0022](./0022-open-runtime-helpers.md) | Open runtime helpers package | Accepted |
| [0023](./0023-public-private-eval.md) | Public vs private Design Agent eval | Accepted |
| [0024](./0024-protocol-version-cross-repo-ci.md) | Protocol version pin + cross-repo CI | Accepted |
| [0025](./0025-billing-protocol.md) | Billing Protocol open / host commercial private | Accepted |
| [0026](./0026-task-centric-billing.md) | Task-centric credits (≠ tokens) | Accepted |
| [0027](./0027-canvas-layered-runtime.md) | Scene + camera + layered render + hit | Accepted |
