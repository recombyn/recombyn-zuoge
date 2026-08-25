# Contributing

Thanks for considering a contribution to zuoge. Please read the [Code of Conduct](./CODE_OF_CONDUCT.md). Security issues go to [SECURITY.md](./SECURITY.md) — don’t file a public issue.

How to run locally: [README.md](./README.md) · [docs/self-hosting.md](./docs/self-hosting.md) · desktop [docs/desktop.md](./docs/desktop.md).

## Setup

```bash
docker compose up -d redis
cp apps/api/.env.example apps/api/.env   # fill LLM keys as needed
npm install
npm run install:api                      # Python API deps
npm run dev:api                          # http://127.0.0.1:8000
npm run dev:stack                        # web :3000 + collab :1234
# or separately:
# npm run dev:web
# npm run dev:collab
# optional desktop (Rust + platform toolchain required):
# npm run dev:desktop
```

Useful scripts:

| Command | Purpose |
|---------|---------|
| `npm run dev:stack` | Web + collab together |
| `npm run dev:web` / `dev:api` / `dev:worker` / `dev:collab` | Individual local servers |
| `npm run check` | Web ESLint + contracts typecheck |
| `npm run ci:gate` | Local mirror of GitHub `CI / gate` (check + web/API unit) |
| `npm run lint` / `typecheck` | Turbo across JS packages |
| `npm run dev:desktop` / `build:desktop` | Tauri **local** (SQLite API sidecar) |
| `npm run dev:desktop:cloud` / `build:desktop:cloud` | Tauri **cloud** UI ([docs/desktop.md](./docs/desktop.md)) |
| `npm run test` | Web + API tests |
| `npm run test:web` / `test:api` | Scoped tests |
| `npm run test:e2e` | Playwright (under `e2e/`) |
| `npm run build` | Production web build |

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/): `feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert`.

`husky` + `commitlint` run on `commit-msg` (also **strips** `Co-authored-by: Cursor`). `pre-push` **rejects** that trailer if it still lands — same as GitHub `no-cursor-coauthor`. Examples:

```bash
feat(canvas): show mark-region live preview while dragging
fix(api): skip soft min_creates without craft skills
chore: add workspace task runner and shared tsconfig
```

Do **not** add AI-assistant `Co-authored-by` trailers (CI rejects `Co-authored-by: Cursor`).

## Architecture decisions (ADR)

Cross-cutting changes need an ADR under [`docs/adr/`](./docs/adr/README.md) (copy the template). Seed docs: monorepo boundaries, RCB canvas, collab. Roadmap: [`docs/roadmap/platform.md`](./docs/roadmap/platform.md).

## Git identity (required)

## Branch & pull request flow (CLI)

1. **Sync default branch**

```bash
git fetch origin main
git checkout main
git pull origin main
```

Work from **this** `main` (or a branch created from `origin/main`). A local `main` that lagged remote is not “latest.” GitHub CI only runs **pushed commits**; untracked `??` files under `apps/` never reach CI.

2. **Create a topic branch**

```bash
git checkout -b feat/short-description
# or: fix/...  docs/...  chore/...
```

3. **Make changes**, keep the diff focused. Prefer helpers in the same file unless shared by 3+ call sites.

4. **Run checks** that match your change

```bash
npm run ci:gate           # preferred before PR (umbrella)
# or scoped:
npm run test:web
npm run test:api:unit
# optional: npm run test:e2e
```

5. **Review what you will commit**

```bash
git status
git diff
git log -5 --oneline      # match existing message style
```

6. **Stage and commit** (message: imperative, why over what; 1–2 sentences)

```bash
git add path/to/changed/files
git commit -m "$(cat <<'EOF'
Add concise subject in imperative mood.

Optional body: why this change matters.
EOF
)"
```

PowerShell:

```powershell
git add path/to/changed/files
git commit -m @"
Add concise subject in imperative mood.

Optional body: why this change matters.
"@
```

Examples of good subjects (same style as this repo):

- `Fix canvas align guides for multi-select`
- `Drop unused assets from apps/web/public`
- `Document self-host MySQL defaults`

7. **Push and open a PR**

```bash
git push -u origin HEAD
gh pr create --fill
# or with an explicit body:
gh pr create --title "Your title" --body "$(cat <<'EOF'
## Summary
- …

## Test plan
- [ ] …
EOF
)"
```

Use the checklist in [`.github/PULL_REQUEST_TEMPLATE.md`](./.github/PULL_REQUEST_TEMPLATE.md).

8. **Address review**, then push again on the same branch (`git push`). Prefer **rebase** onto `main` if asked; avoid rewriting commits that others already based work on.

## Do / don’t

| Do | Don’t |
|----|--------|
| Small, focused PRs | Mix unrelated refactors with features |
| Verify email before first push | Commit `.env`, keys, or local IDE folders (`.cursor/`) |
| Link issues in the PR body | Force-push `main` / rewrite published history without maintainers |
| Update docs when behavior changes | Leave failing tests on the default branch |
| Document open protocols / SDKs / BasicLocal | Document proprietary intelligence backends, private datasets, closed prompts, or private service layouts in this repo |

## Intelligence providers

Design Runtime calls `packages/intelligence-client` (`DesignIntelligenceClient`). The default is **BasicLocal** (in-repo, no network). Optional remote providers use `RECOMBYN_INTELLIGENCE_MODE=cloud` + `RECOMBYN_INTELLIGENCE_URL` and must implement the open `IntelligenceProvider` protocol — see [ADR 0017](./docs/adr/0017-intelligence-provider-boundary.md). Compose override: `docker-compose.intelligence.yml` (`--profile intelligence`). **Do not** add docs that describe closed / proprietary provider internals in this repository.

Shared wire contract lives in `packages/protocol` (`recombyn-protocol`). Bump its version when method names / request keys / usable rules change ([ADR 0024](./docs/adr/0024-protocol-version-cross-repo-ci.md)). Operators who maintain a private Intelligence service should depend on that package and run compatibility tests against it — do not hand-copy method lists into closed repos.


Open skill pack helpers live in `packages/skill-sdk` (`normalize_pack_meta`, `parse_extends`, …) — see [ADR 0019](./docs/adr/0019-open-skill-sdk.md). Open `.recombyn-plugin` manifest helpers live in `packages/plugin-sdk` — see [ADR 0020](./docs/adr/0020-open-plugin-sdk.md). Kernel stage vocabulary lives in `packages/agent-sdk` — see [ADR 0021](./docs/adr/0021-open-agent-sdk.md). Remote intelligence request helpers live in `packages/runtime` — see [ADR 0022](./docs/adr/0022-open-runtime-helpers.md).

## Commit message conventions

- **Subject**: imperative (`Add`, `Fix`, `Remove`, …), ~72 chars, no trailing period required.
- **Body** (optional): motivation and user-visible impact.
- Prefer English for commit subjects (matches git history); PR descriptions may be Chinese or English.

## License

By contributing, you agree that your contributions are licensed under the [Apache License 2.0](./LICENSE).
