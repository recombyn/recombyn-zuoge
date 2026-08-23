# Open-source release checklist (maintainers)

Before making the repository public:

1. **Secrets** — `git grep` for real API keys, passwords, internal hostnames; rotate anything that ever leaked.
2. **Env** — only `*.env.example` committed; compose defaults documented as insecure-for-prod.
3. **URLs** — set real GitHub org in README badges / issue config when the remote exists.
4. **CI** — ensure `.github/workflows/*` pass on a clean clone.
5. **License headers** — root `LICENSE` + `NOTICE` are enough for Apache-2.0; no need to stamp every file (optional per-file boilerplate if your process requires it).
6. **Tag** — cut `v0.x.0` with release notes pointing at `docs/self-hosting.md`.
