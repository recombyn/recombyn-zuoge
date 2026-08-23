# ADR 0001: Monorepo app/package boundaries

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Recombyn ships a canvas web app, a Python Design Agent API, a collab server, and shared contracts. We need clear ownership so tooling (lint, CI) and future async/observability work do not blur process boundaries.

## Decision

| Path | Role | Runtime |
|------|------|---------|
| `apps/web` | Editor UI + Tauri shell | Node / browser |
| `apps/api` | HTTP API, Design Agent, auth, projects | Python |
| `apps/collab` | Yjs WebSocket room server | Node |
| `packages/contracts` | OpenAPI → TS client contracts | Node (codegen) |
| `packages/protocol` | Open Design / Intelligence / Paint / **Billing** contracts + schemas | Python |
| `packages/intelligence-client` | DesignIntelligenceClient + provider protocol | Python |
| `packages/billing-sdk` | Open Usage/Cost builders over Billing Protocol | Python |
| `packages/eval-framework` | Public eval compare helpers | Node |
| `packages/tsconfig` (`@repo/tsconfig`) | Shared TS bases | tooling |
| `packages/eslint-config` (`@repo/eslint-config`) | Shared ESLint flat configs | tooling |
| `packages/scene-schema` / `scene-builder-py` | Scene document schema / builders | dual |

- **npm workspaces** own JS/TS packages; Python stays under `apps/api` with its own venv/`pip install -e`.
- **Workspace task runner** orchestrates JS package tasks (`build` / `lint` / `typecheck` / `test` / `dev`). API tests remain `npm run test:api` (or Gate scripts), not forced into npm workspace graphs.
- Cross-language contracts flow through OpenAPI / `packages/contracts`, not ad-hoc shared folders.

## Consequences

### Positive

- Clear CI path filters and task caching for web/collab/contracts.
- Shared lint/tsconfig without dumping utils into `src/utils`.

### Negative / trade-offs

- Developers need both Node and Python toolchains.
- The JS task runner does not schedule Python tasks; document Gate A/B separately.

## Alternatives considered

1. **Single mega-app** — rejected; collab and API scale/deploy differently.
2. **Put API inside npm workspace via wrapper** — deferred; adds little until Python packaging is standardized.

## References

- `turbo.json`, `package.json` workspaces
- `docs/quality-gates.md`
