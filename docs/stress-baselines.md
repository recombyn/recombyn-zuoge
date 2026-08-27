# Stress & load baselines

How to capture a performance baseline (canvas, API, collab, Agent). Tools already exist — don’t invent a second harness.

## Matrix

| Surface | Command | Artifact / truth |
|---------|---------|------------------|
| Canvas store + E2E stress | `npm run test:canvas:stress` | Console + Playwright/HTML; optional JSON under `e2e/tests/*.results.json` (local, gitignored if untracked) |
| Canvas product E2E only | `npm run test:canvas:product` | Same (ops + deep + tools in one spec) |
| Vitest canvas stress | `npm run test:stress --workspace=apps/web` | Vitest (local) |
| API k6 smoke | `npm run perf:k6:smoke` | k6 summary; CI: `perf-k6.yml` |
| API CRUD load | `PERF_TOKEN=… npm run perf:k6:api` | k6 |
| Collab WS | `COLLAB_WS_URL=ws://127.0.0.1:1234 npm run perf:k6:collab` | k6 |
| Dual Yjs merge | `COLLAB_WS_URL=… npm run test:collab:merge` | Console `ok` / exit 0 |
| Soak | `npm run perf:k6:soak` (nightly) | `nightly-quality.yml` |
| Agent concurrency | `npm run test:agent:concurrency` | Script stdout / eval hooks |

## Recording a baseline (maintainers)

1. Use a quiet machine; note commit SHA: `git rev-parse --short HEAD`.
2. Start stack as needed (`npm run dev:stack`, `dev:api`, Redis, collab).
3. Run one row from the matrix; save the k6/Playwright summary next to the SHA in the PR or an issue comment (do not commit large result JSON by default).
4. Compare the next release against that SHA — look for p95 / error-rate / flake-rate regressions, not absolute “pass forever”.

## Intentional gaps (still)

- Real provider paid image/video gen finish in CI (opt-in: `E2E_PAID_IMAGE_GEN=1`)
- Full 5k SVG host DOM mount (product uses ≤96 full hosts + Canvas idle — covered by `canvas5k.interactiveBudget`)

Dual-client Yjs concurrent merge: `npm run test:collab:merge` (also Gate B `perf-k6.yml`).

See [quality-gates.md](./quality-gates.md) Gate A/B and [platform.md](./roadmap/platform.md) Phase 5–6.
