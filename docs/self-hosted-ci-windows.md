# Self-hosted CI (Windows) — recombyn-dev

Private repo `recombyn-dev` does not get unlimited GitHub-hosted Actions minutes. When hosted runners are blocked (billing / spending limit), jobs fail in ~2s with **0 steps** and annotation:

> The job was not started because recent account payments have failed or your spending limit needs to be increased.

A **self-hosted runner** on your Windows PC runs the same CI jobs **without** consuming hosted minutes.

## One-time setup

### 1. Install toolchain on the runner machine

| Tool | Version |
|------|---------|
| Git for Windows | latest |
| Node.js | 22 LTS |
| Python | 3.12 |

Add `node`, `npm`, `python`, `git` to PATH.

### 2. Register the runner

1. Open **GitHub → recombyn/recombyn-dev → Settings → Actions → Runners → New self-hosted runner → Windows**
2. Copy the **registration token** (valid ~1 hour)
3. In PowerShell from repo root:

```powershell
.\scripts\setup-self-hosted-runner.ps1 -RegistrationToken "PASTE_TOKEN_HERE"
```

4. Start the runner:

```powershell
# Option A — foreground (good for testing; keep window open)
cd $env:USERPROFILE\actions-runner-recombyn
.\run.cmd

# Option B — Windows service (Admin; survives logout/reboot after svc.start)
.\svc.install
.\svc.start
```

5. Confirm runner shows **Idle** in GitHub Settings → Actions → Runners.

Labels applied: `self-hosted`, `Windows`, `ci` (required by `.github/workflows/ci.yml`).

## What runs where

| Workflow | Runner | Notes |
|----------|--------|--------|
| **CI** (`ci.yml`) | self-hosted Windows | lint, typecheck, unit tests, web build |
| E2E, k6, Publish OSS | GitHub-hosted (optional) | still use `ubuntu-latest`; reduce triggers or fix billing separately |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Jobs queued forever | Runner offline — start `run.cmd` or `svc.start` |
| Jobs skipped / wrong OS | Runner must have labels `Windows` and `ci` |
| `npm ci` slow first time | Normal; later runs reuse `node_modules` on same machine |
| PC sleep | Use Windows service + disable sleep on runner PC |

## Local pre-push (optional)

```powershell
npm run check; npm run typecheck:web; npm run test:web
cd apps/api; python -m ruff check app worker --select F401; python -m pytest tests/unit_tests -q
```
