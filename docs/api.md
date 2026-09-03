# API

The HTTP API is FastAPI. Local base: `http://localhost:8000/api/v1` · Swagger: http://127.0.0.1:8000/docs

Architecture / Agent: [self-hosting.md](./self-hosting.md#architecture) · Profile / sub-agents: [agent-profile.md](./agent-profile.md) · Deployment modes: [deployment-modes.md](./deployment-modes.md) · User docs: [recombyn.github.io/recombyn](https://recombyn.github.io/recombyn/)

| Prefix | Notes |
|--------|-------|
| `/auth` | Login / OAuth / session · `GET /auth/config` → `googleEnabled`, `emailEnabled`, **`billingEnabled`** (`WALLET_BILLING_ENABLED`) |
| `/projects` | Project CRUD |
| `/plaza` | Feed / submissions / likes |
| `/chat` · `/chat-sessions` | Agent chat |
| `/uploads` · `/fonts` | Uploads / fonts |
| `/image-tools` | Vision tools |
| `/shares` · `/notices` · `/users` | Shares, notices, directory |
| `/design/*` | Design Agent SSE, catalog, scene |
| `/wallet` | Credits, membership catalog, redeem (requires auth for `/wallet/me`) |
| `/import/*` | Image → Scene |
| `/admin/*` | Admin only |

`GET /wallet/plans` — list prices + monthly credit grants. No margin fields.

Billing UI visibility is **not** tied to `/wallet` success — clients use `GET /auth/config` → `billingEnabled` (default `true`). See [billing.md](./billing.md).

`POST /design/run` extras (see [agent-profile.md](./agent-profile.md#run-request-locale--design-intensity)):

| Field | Values | Role |
|-------|--------|------|
| `locale` | `zh-CN` \| `zh-TW` \| `en` \| `ja` | Agent output language |
| `design_intensity` | `light` \| `medium` \| `high` \| `extreme` | Pipeline depth (review + strategy stack), not model thinking |

`GET /api/v1/health` → `{ "status": "ok"|"degraded", "checks": { … } }`
