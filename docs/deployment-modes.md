# Deployment modes

How to run zuoge on your own infrastructure or machine.

| Mode | Typical URL | How |
|------|-------------|-----|
| **Self-host** | https://your.domain | `docker compose` on your server |
| **Local dev** | http://localhost:3000 | `npm run dev:api` + `dev:web` |
| **Desktop (Tauri)** | Native window | Same web app + API — [desktop.md](./desktop.md) |

| | Command | API |
|--|---------|-----|
| Dev | `npm run dev:desktop` | Local `:8000` + `apps/api/.env` |
| Release build | `npm run build:desktop` | Optional `VITE_API_BASE_URL=https://your.host` |

## Authentication

| Method | Required env | Notes |
|--------|--------------|-------|
| **Email OTP** | Tencent Cloud SES (`TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `SES_*`) | Codes are sent by email only — **no console fallback** |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Alternative or addition to email |

Without SES, `POST /auth/login` (email) returns **503** with a configuration hint. Configure SES or enable Google OAuth before exposing login publicly.

→ [self-hosting.md § Email login](./self-hosting.md#email-login-configure-ses)

## Credits & billing

| Piece | Detail |
|-------|--------|
| **Runtime switch** | `WALLET_BILLING_ENABLED` in `apps/api/.env` (default **`true`**) |
| **Public flag** | `GET /api/v1/auth/config` → `billingEnabled` |
| **UI rule** | Frontend shows/hides credits UI from **`billingEnabled` only** — `/wallet` errors do **not** hide balance or plans |
| **Protocol** | Task-centric credits + Billing Protocol — [billing.md](./billing.md) |

Set `WALLET_BILLING_ENABLED=false` only when you explicitly want platform billing off.

Optional when billing is on: daily free quota (`FREE_DAILY_LIMIT`), card keys (`CARD_KEY_SALT`, `CARD_KEY_OPS_PASSWORD`).

## Related

- [self-hosting.md](./self-hosting.md) — Compose, MySQL, MinIO, collab, production checklist
- [billing.md](./billing.md) — Billing Protocol + task pricing floor
- [api.md](./api.md) — HTTP surface (`/auth`, `/wallet`, …)
- [web-frontend.md](./web-frontend.md) — `useBillingEnabled`, wallet Query cache
