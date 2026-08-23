# Private → public sync (recombyn-dev → recombyn)

Develop in the **private** monorepo; the public repo is an automated OSS mirror without commercial code.

One checkout (`recombyn-dev`) replaces the old three-repo layout:

| Before | After (recombyn-dev) |
|--------|----------------------|
| `recombyn/recombyn` (public) | Still mirrored automatically — do not push features here |
| `recombyn/recombyn-dev` (private app) | `origin` — daily push target |
| `recombyn/recombyn-intelligence` (private) | `src/commercial/intelligence/` |

## Repositories

| Remote | GitHub | Role |
|--------|--------|------|
| `origin` | `recombyn/recombyn-dev` | Daily development (includes `src/commercial/`) |
| `public` | `recombyn/recombyn` | OSS mirror — do not push here directly |

## One-time setup

### 1. Create the private repo (org admin)

```bash
gh repo create recombyn/recombyn-dev --private --description "Private dev monorepo"
```

### 2. Configure local remotes

```bash
npm run setup:private-remote
# or: node scripts/setup-private-remote.mjs
```

### 3. Push private `main`

```bash
git push -u origin main
```

### 4. GitHub Actions secret (private repo only)

Private repo → **Settings → Secrets → Actions** → `PUBLIC_REPO_TOKEN`

Use a fine-grained or classic PAT with **Contents: Read and write** on `recombyn/recombyn`.

```bash
gh secret set PUBLIC_REPO_TOKEN --repo recombyn/recombyn-dev
# paste token when prompted
```

### 5. Verify sync

```bash
gh workflow run sync-public.yml --repo recombyn/recombyn-dev
gh run list --repo recombyn/recombyn-dev --workflow sync-public.yml
```

Public `main` should update within ~1 minute.

## Daily workflow

1. Commit on `recombyn-dev` `main`.
2. `git push origin main`
3. Action mirrors to public automatically.

**Never** push feature work to `public` directly.

## Filtered paths (not in OSS mirror)

| Path | Reason |
|------|--------|
| `src/commercial/` | Closed-source product code |
| `apps/web/src/private/` | Local override scratch |
| `apps/api/private-eval/` | Closed eval corpora |
| `.github/workflows/sync-public.yml` | Sync job stays private-only |
| `scripts/setup-private-remote.mjs` | Private-remote helper |

## Pulling public changes back

Sync is **private → public** only. Cherry-pick or merge public PRs into `recombyn-dev` manually, then push private `main` again.
