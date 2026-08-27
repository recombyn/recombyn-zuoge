# Gate B — k6 load scenarios

Load scripts for a running API (`BASE_URL`). Install [k6](https://k6.io/docs/get-started/installation/) first. Full matrix: [docs/quality-gates.md](../../docs/quality-gates.md).

| Script | Purpose | Auth |
|--------|---------|------|
| `smoke.js` | `/`, `/api/v1/health`, `/metrics` (or soak with `K6_SOAK=1`) | no |
| `api_crud.js` | `/auth/me` + projects under load | `PERF_TOKEN` |
| `collab_ws.js` | Yjs WS open/auth | `COLLAB_TOKEN_SECRET` |

```bash
k6 run perf/k6/smoke.js
PERF_TOKEN="$(cat .tmp-token.txt)" k6 run perf/k6/api_crud.js
COLLAB_WS_URL=ws://127.0.0.1:1234 npm run perf:k6:collab
npm run perf:k6:soak   # same as: k6 run -e K6_SOAK=1 perf/k6/smoke.js
```

See `docs/quality-gates.md`.
