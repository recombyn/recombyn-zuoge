# Desktop (Tauri v2)

Native window for the **same product** as the browser ([deployment-modes.md](./deployment-modes.md)).

| | Command | API |
|--|---------|-----|
| **Dev** | `npm run dev:desktop` | Same as browser: Vite `:3000` + API `:8000` + `apps/api/.env` |
| **Build** | `npm run build:desktop` | Optional `VITE_API_BASE_URL=https://your.host` for a hosted API |

Product id: `com.recombyn.app.cloud` · **Recombyn Cloud**

There is no offline / bundled-API desktop mode — the shell always talks to a running API (local uvicorn or your deployed host).

## Login & billing

Same as the web app:

- **Email OTP** — requires SES in `apps/api/.env` (no console codes)
- **Google OAuth** — optional `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
- **Credits** — `WALLET_BILLING_ENABLED` (default `true`); UI follows `GET /auth/config` → `billingEnabled`

→ [billing.md](./billing.md) · [self-hosting.md § Email login](./self-hosting.md#email-login-configure-ses)

## Prerequisites

1. **Node.js** + repo `npm install`
2. **Rust** ([rustup](https://rustup.rs)) + platform C++/WebView toolchain
3. **Dev:** `apps/api` Python venv (`pip install -e ".[dev]"`)

## Commands

```bash
npm run dev:desktop
npm run build:desktop
# VITE_API_BASE_URL=https://recombyn.com npm run build:desktop
```

Build output: `apps/web/src-tauri/target/release/bundle/`

## Architecture

```
npm run dev:desktop
  → ensure-desktop-api.mjs (uvicorn with apps/api/.env)
  → Tauri + Vite :3000 (proxy /api → :8000)
```

- **API URL helper:** `apps/web/src/utils/apiBase.ts`
- **Tauri config:** `src-tauri/tauri.conf.json`

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| API errors on launch | Run `npm run dev:api` separately or check Docker MySQL is up |
| Port 8000 in use | Stop other API processes; restart `dev:desktop` |
| Wrong API / stale session | Sign out and log in again with email or Google |
| Credits UI missing | Check `GET /api/v1/auth/config` → `billingEnabled`; default is `true` unless `WALLET_BILLING_ENABLED=false` |

Code signing: [ADR 0010](./adr/0010-desktop-signing.md)
