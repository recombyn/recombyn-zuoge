# Deployment modes

One codebase — same product whether you use our cloud, self-host, or develop locally.

| Mode | Who runs it | Typical URL | How |
|------|-------------|-------------|-----|
| **Cloud SaaS** | recombyn.com | https://recombyn.com | Managed by the team |
| **Self-host** | You / your org | https://your.domain | `docker compose` on your server |
| **Local dev** | Developers | http://localhost:3000 | `npm run dev:api` + `dev:web` (not a separate SKU) |

**Desktop (Tauri)** is not a fourth product mode. It is the same web app in a native window, using the same API as the browser.

| | Command | API |
|--|---------|-----|
| Dev | `npm run dev:desktop` | Local `:8000` + `apps/api/.env` (same as browser dev) |
| Release build | `npm run build:desktop` | Optional `VITE_API_BASE_URL=https://your.host` |

→ [desktop.md](./desktop.md)

## Self-host = cloud parity

Self-hosted instances run **the same API and web** as `recombyn.com`. You operate the server and data; feature flags and billing defaults match cloud unless you override env vars.

Out of the box (no extra billing config):

- `WALLET_BILLING_ENABLED` defaults to **`true`** (app settings, Compose, k8s ConfigMap)
- Credits UI, plans, redeem, and usage tabs are **on** — same as cloud

Set `WALLET_BILLING_ENABLED=false` only when you explicitly want platform billing off.

## Authentication (all modes)

| Method | Required env | Notes |
|--------|--------------|-------|
| **Email OTP** | Tencent Cloud SES (`TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `SES_*`) | Codes are sent by email only — **no console fallback** |
| **Google OAuth** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Alternative or addition to email |

Without SES, `POST /auth/login` (email) returns **503** with a configuration hint. Configure SES or enable Google OAuth before exposing login publicly.

→ [self-hosting.md § Email login](./self-hosting.md#email-login-configure-ses)

## Credits & billing (all modes)

| Piece | Detail |
|-------|--------|
| **Runtime switch** | `WALLET_BILLING_ENABLED` in `apps/api/.env` (default **`true`**) |
| **Public flag** | `GET /api/v1/auth/config` → `billingEnabled` |
| **UI rule** | Frontend shows/hides credits UI from **`billingEnabled` only** — `/wallet` errors do **not** hide balance or plans |
| **Protocol** | Task-centric credits + Billing Protocol — [billing.md](./billing.md) |

Optional when billing is on: daily free quota (`FREE_DAILY_LIMIT`), card keys (`CARD_KEY_SALT`, `CARD_KEY_OPS_PASSWORD`).

## Related

- [self-hosting.md](./self-hosting.md) — Compose, MySQL, MinIO, collab, production checklist
- [billing.md](./billing.md) — Billing Protocol + task pricing floor
- [api.md](./api.md) — HTTP surface (`/auth`, `/wallet`, …)
- [web-frontend.md](./web-frontend.md) — `useBillingEnabled`, wallet Query cache
