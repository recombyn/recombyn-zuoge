# Desktop (Tauri v2)

You can run Recombyn as a desktop app (Tauri v2). Two flavors: **Local** (bundled API + SQLite) and **Cloud** (same API as the browser).

| | Command | API | Product id |
|--|---------|-----|------------|
| **Local** | `npm run dev:desktop` / `build:desktop` | Bundled API sidecar + SQLite (app data) | `com.recombyn.app` · Recombyn |
| **Cloud** | `npm run dev:desktop:cloud` / `build:desktop:cloud` | Same as browser: local `:8000` + `apps/api/.env` (opt-in `VITE_API_BASE_URL` when a host is deployed) | `com.recombyn.app.cloud` · Recombyn Cloud |

## Local data & login

**Local desktop** UI talks to **`127.0.0.1:8000`** SQLite + `storage/uploads` (sidecar / `ensure-desktop-api` with auto-login).

**Cloud desktop (dev)** uses the same API stack as `npm run dev:web` — Vite proxies `/api` → `:8000` with `apps/api/.env` (MySQL etc.). It does **not** rewrite to SQLite and does **not** assume `https://recombyn.com` (that host is optional; set `VITE_API_BASE_URL` only when you have a real deploy).

**Login:** Local desktop auto-signs in as the OS user (`DESKTOP_LOCAL_AUTO_LOGIN`, loopback-only `POST /auth/desktop-local`). No email OTP. Cloud desktop / browser still use normal login.

**Billing UI:** Local flavor hides plans / redeem / upgrade (no cloud account switch in-app — use the Cloud desktop build for that).

**Models:** Local does **not** expose the platform LLM catalog (no Seedream / OpenRouter entries for end users). Add your own OpenAI-style providers + API keys under Agent settings (BYOK). Wallet holds are skipped.

## Prerequisites

1. **Node.js** + repo `npm install`
2. **Rust** ([rustup](https://rustup.rs)) + platform C++/WebView toolchain
3. **Local flavor**
   - **Dev:** `apps/api` Python venv (`pip install -e ".[dev]"`)
   - **Release EXE:** PyInstaller sidecar (`pip install -e ".[desktop]"` or the build script installs `pyinstaller`)

## Commands

```bash
# Dev local — live Python API on :8000 + Tauri window
npm run dev:desktop

# Build API sidecar only (PyInstaller onedir → src-tauri/sidecars/recombyn-api/)
npm run build:desktop:sidecar

# Release local installer (builds sidecar if missing, embeds it as Tauri resources)
npm run build:desktop

# Force rebuild sidecar then app:
# RECOMBYN_REBUILD_SIDECAR=1 npm run build:desktop

# Cloud desktop — same API as browser (no SQLite rewrite; optional hosted URL)
npm run dev:desktop:cloud
npm run build:desktop:cloud
# VITE_API_BASE_URL=https://your.host npm run dev:desktop:cloud
```

### Output paths (after `build:desktop`)

| What | Path |
|------|------|
| Installers (NSIS / MSI 等) | `apps/web/src-tauri/target/release/bundle/` |
| Unpacked main EXE | `apps/web/src-tauri/target/release/recombyn.exe` |
| API sidecar (build staging) | `apps/web/src-tauri/sidecars/recombyn-api/recombyn-api.exe` |

Cloud build uses the same `bundle/` tree; product name is **Recombyn Cloud**.

## Code signing (release)

Unsigned builds are fine for local QA. Store / SmartScreen / Gatekeeper need org certificates — **never commit** `.p12`, `.pem`, or notarization credentials.

### Windows (Authenticode)

1. Obtain a code-signing certificate (EV preferred for SmartScreen reputation).
2. Configure Tauri / signtool per [Tauri Windows](https://v2.tauri.app/distribute/windows-installer/) (thumbprint or Azure Trusted Signing).
3. CI secrets (when ready): store cert material in GitHub Environments, not in the repo.

### macOS (Developer ID + notarization)

1. Apple Developer ID Application certificate + App-specific notarization API key.
2. Follow [Tauri macOS](https://v2.tauri.app/distribute/macos-application/).

### Tauri updater signatures (optional)

Env vars (local or Actions secrets):

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

See [ADR 0010](./adr/0010-desktop-signing.md). CI: **Actions → Desktop build (Tauri)** (`workflow_dispatch`) produces **unsigned** Windows artifacts by default.

## Architecture

```
Local release
  Recombyn.exe
    → spawns resources/recombyn-api/recombyn-api.exe  (PyInstaller onedir)
    → SQLite + uploads under app data dir

Local dev
  npm run dev:desktop
    → ensure-desktop-api.mjs (uvicorn from apps/api/.venv)
    → Tauri loads Vite :3000 (proxy /api → :8000)

Cloud desktop (dev)
  npm run dev:desktop:cloud
    → ensure-desktop-api.mjs flavor=cloud (uvicorn with apps/api/.env; no auto-login)
    → Tauri + Vite :3000 (proxy /api → :8000) — same as browser
    → optional VITE_API_BASE_URL when a public API is deployed
```

- **Sidecar entry:** `apps/api/scripts/desktop_sidecar_main.py`
- **Stage script:** `scripts/build-desktop-sidecar.mjs`
- **Tauri resources (local build):** `src-tauri/tauri.local.conf.json`
- **Spawn logic:** `src-tauri/src/local_api.rs` (bundled exe first, Python fallback)
- **API URL helper:** `apps/web/src/utils/apiBase.ts`

## Troubleshooting

| Symptom | What to try |
|---------|-------------|
| Skills / projects “Request failed” | Re-login — old cloud JWT won’t match a fresh local SQLite DB |
| Still shows email/OTP login | Auto-login failed — often stale SQLite schema; pull latest, restart `dev:desktop`, or delete `apps/api/storage/recombyn.db` |
| Sidecar build fails | `cd apps/api && .venv\Scripts\activate && pip install -e ".[desktop]"` |
| Release app won’t start API | Confirm `sidecars/recombyn-api/recombyn-api.exe` exists before/after build |
| Port 8000 in use | Quit other API / previous desktop; `ensure-desktop-api` refuses a listener without working auto-login |
| Want browser’s MySQL/.env in desktop | Use **cloud** flavor (`dev:desktop:cloud`), not local |
| Public `recombyn.com` unreachable | Expected until deployed — cloud desktop defaults to local `:8000`; set `VITE_API_BASE_URL` only for a live host |

## Related

- [self-hosting.md](./self-hosting.md)（含架构 / LC·LG）
- [ADR 0010 — desktop signing](./adr/0010-desktop-signing.md)
- `scripts/dev-desktop.mjs` · `scripts/ensure-desktop-api.mjs`
