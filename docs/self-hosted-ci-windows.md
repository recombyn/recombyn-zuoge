# Self-hosted CI (Windows) — recombyn-dev

All workflows in this repo run on the **self-hosted Windows runner**
(`labels: self-hosted, Windows, ci`). They do **not** use GitHub-hosted
`ubuntu-latest` / `windows-latest`, so they do not consume hosted Actions minutes
or trip billing / spending-limit blocks.

## One-time setup

### 1. Install toolchain on the runner machine

| Tool | Version |
|------|---------|
| Git for Windows | latest (includes Git Bash + optional rsync) |
| Node.js | 22 LTS |
| Python | 3.12 |
| Docker Desktop | optional — Redis for perf/nightly if no local Redis |
| k6 | optional — otherwise CI downloads Windows zip |
| Playwright Chromium | installed by E2E job via `npx playwright install chromium` |

Add `node`, `npm`, `python`, `git`, and preferably `docker` / `k6` to PATH.
Git Bash must be available (`shell: bash` steps).

### 2. Register the runner

1. Open **GitHub → recombyn/recombyn-dev → Settings → Actions → Runners → New self-hosted runner → Windows**
2. Copy the **registration token** (valid ~1 hour)
3. In PowerShell from repo root:

```powershell
.\scripts\setup-self-hosted-runner.ps1 -RegistrationToken "PASTE_TOKEN_HERE"
```

4. Start the runner:

```powershell
cd C:\actions-runner
.\run.cmd
```

5. Confirm runner shows **Idle** in GitHub Settings → Actions → Runners.

Labels applied: `self-hosted`, `Windows`, `ci` (required by all workflows).

## What runs where

| Workflow | When | Notes |
|----------|------|--------|
| **CI** (`ci.yml`) | every PR / main push | lint, typecheck, unit, build, gate — the only auto gate |
| **Publish OSS** | main push / manual | sync to `recombyn/zuoge` |
| E2E / Skill eval / Perf k6 | **manual** (`workflow_dispatch`) | run locally first; do not auto-queue |
| Nightly | schedule / manual | soak only |
| Protocol smoke / compat | path-filtered | only when protocol packages change |

Auto-running Playwright/k6/skill on every push overcrowds the single self-hosted runner and often clashes with local `dev:web` — that is env noise, not “your app tests failed.”

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Jobs queued forever | Runner offline — start `run.cmd` or `svc.start` |
| Jobs skipped / wrong OS | Runner must have labels `Windows` and `ci` |
| Hosted billing errors (~2s, 0 steps) | Should not appear — workflows must not use `ubuntu-latest` |
| Redis / k6 missing | Install locally or let Docker / download steps provision |
| `npm ci` slow first time | Normal; later runs reuse caches on the same machine |
| PC sleep | Use Windows service + disable sleep on runner PC |

## Local pre-push (optional)

```powershell
npm run check; npm run typecheck:web; npm run test:web
cd apps/api; python -m ruff check app worker --select F401; python -m pytest tests/unit_tests -q
```
