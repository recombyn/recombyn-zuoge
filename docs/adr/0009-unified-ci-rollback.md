# ADR 0009: Unified CI gate + Docker tag rollback

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Phase 1–3 left us with path-filtered workflows (web / api / e2e / perf) but no single PR gate for `lint → typecheck → unit`. e2e and Docker publish are heavier. We need a required-style umbrella without inventing k8s.

## Decision

1. **Umbrella workflow** `.github/workflows/ci.yml` on every PR / push to main:
   - `check` — `npm run check` (web ESLint + contracts typecheck) **and** `npm run typecheck:web`
   - `web-unit` — `npm run test:web`
   - `api-unit` — Alembic single head + API unit tests (+ hydrate cov floor)
   - `build-web` — `npm run build` (Vite production build)
   - `gate` — succeeds only if the above succeed (branch protection can require `CI / gate`)
2. **Keep specialized workflows** (e2e, perf-k6, nightly, dep-audit) — not folded into the umbrella yet.
3. **Gate on `typecheck:web`** once Phase 1 web `tsc` debt is cleared (done).
4. **Semver / CHANGELOG:** Keep a Changelog at repo root; tags `vMAJOR.MINOR.PATCH` when cutting releases (manual until a release workflow exists).
5. **Rollback:** Docker Compose image/tag rollback documented in `docs/self-hosting.md` (previous known-good tag → `up -d`). No k8s manifests in this phase.
6. **GHCR publish:** `.github/workflows/release-docker.yml` on `v*.*.*` tags pushes `ghcr.io/<owner>/<repo>/{api,web,collab}`; `docker-compose.ghcr.yml` pulls them.

## Consequences

### Positive

- One green/red signal for monorepo PRs that touch any app.
- Local mirror: `npm run ci:gate` (check + web typecheck + web/API unit).

### Negative / trade-offs

- Umbrella runs even for docs-only PRs (acceptable cost).
- e2e remains optional / path-filtered — full “unit→e2e→build” chain is partially split.

## Alternatives considered

1. **Only extend web-tests.yml** — misses API on web-only PRs.
2. **Require e2e in umbrella** — too slow/flaky for first slice.
3. **GHCR publish now** — defer until tags are routine.

## References

- `.github/workflows/ci.yml`
- [quality-gates.md](../quality-gates.md)
- [self-hosting.md](../self-hosting.md) (rollback)
- [CHANGELOG.md](../../CHANGELOG.md)
