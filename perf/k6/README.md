# Gate B — k6 load scenarios

Load scripts for a running API (`BASE_URL`). Install [k6](https://k6.io/docs/get-started/installation/) first. Full matrix: [docs/quality-gates.md](../../docs/quality-gates.md).

| Script | Purpose | Auth |
|--------|---------|------|
| `smoke.js` | `/`, `/api/v1/health`, `/metrics` | no |
| `api_crud.js` | `/auth/me` + projects under load | `PERF_TOKEN` |
| `soak.js` | Sustained health/metrics | no |
| `collab_ws.js` | Yjs WS open/auth | `COLLAB_TOKEN_SECRET` |

```bash
k6 run perf/k6/smoke.js
PERF_TOKEN="$(cat .tmp-token.txt)" k6 run perf/k6/api_crud.js
COLLAB_WS_URL=ws://127.0.0.1:1234 npm run perf:k6:collab
npm run perf:k6:soak
```

See `docs/quality-gates.md`.
