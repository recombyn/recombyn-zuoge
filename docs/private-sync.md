# Private → public sync (recombyn-dev → recombyn)

**Two repositories only.** Develop in `recombyn-dev`; public `recombyn` is an automated mirror with commercial code **deleted**, not hidden behind runtime flags.

| Remote | GitHub | Role |
|--------|--------|------|
| `origin` | `recombyn/recombyn-dev` | Daily development (full tree) |
| `public` | `recombyn/recombyn` | OSS mirror — never push features here |

## How stripping works

On each push to `recombyn-dev` `main`, `sync-public.yml`:

1. `rsync` the full private tree into a clone of public `recombyn`
2. **`sync-public-strip.mjs`** — hard-deletes paths in `src/commercial/oss-exclude.paths`
3. Overlays **`oss-stubs/`** — OSS-safe replacements (empty commercial hosts, no `ilpEnabled` branches)
4. Verifies `src/commercial/` is gone before push

No third repo. Intelligence lives at `src/commercial/intelligence/` and is removed from the public copy.

## Commercial code layout (recombyn-dev)

```
src/commercial/
  intelligence/     # Design Intelligence service (8091)
  web/              # @commercial/* modules (layer mask, mockup, …)
  oss-exclude.paths # delete list for public mirror

apps/web/src/commercial/   # thin wiring (overwritten by oss-stubs/ on sync)
oss-stubs/                 # OSS-safe versions copied onto public mirror
```

## Setup

```bash
npm run setup:private-remote   # origin → recombyn-dev, public → recombyn
git push origin main           # triggers sync
```

Secret on **recombyn-dev**: `PUBLIC_REPO_TOKEN` (write access to `recombyn/recombyn`).

```bash
gh secret set PUBLIC_REPO_TOKEN --repo recombyn/recombyn-dev
```

## Daily workflow

1. Commit on `recombyn-dev` `main`
2. `git push origin main`
3. Action deletes commercial paths and pushes public `main`

## Adding a closed feature

1. Implement under `src/commercial/web/…` (or `intelligence/`)
2. Wire from `apps/web/src/commercial/…` in private dev
3. Add an OSS stub under `oss-stubs/apps/web/src/commercial/…` (no-op)
4. If the feature has no public equivalent, add its path to `oss-exclude.paths`

Do **not** gate OSS UI with `ilpEnabled` — public builds should not contain the code at all.

## Pulling public changes back

Sync is private → public only. Cherry-pick public PRs into `recombyn-dev`, then push private `main` again.
