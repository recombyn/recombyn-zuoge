# Private → public sync (recombyn-dev → zuoge)

**Internal only** — this file lives under `docs/commercial/` and is not published to `recombyn/zuoge`.

**Two repositories only.** Develop in `recombyn-dev`; public `zuoge` is an automated mirror with commercial code **deleted**, not hidden behind runtime flags.

| Remote | GitHub | Role |
|--------|--------|------|
| `origin` | `recombyn/recombyn-dev` | Daily development (full tree) |
| `public` | `recombyn/zuoge` | Public mirror — never push features here |

## How stripping works

On each push to `recombyn-dev` `main`, `sync-public.yml`:

1. `rsync` the full private tree into a clone of public `zuoge`
2. **`sync-public-strip.mjs`** — hard-deletes paths in `scripts/oss-exclude.paths`
3. Overlays **`scripts/oss-stubs/`** — empty commercial wiring for the public tree
4. Verifies `apps/intelligence`, `apps/web/src/commercial/mockup`, and `docs/commercial` are gone before push
5. Commits to `zuoge` with a **sanitized** copy of the private commit message
   (no `sync` / `mirror` / `recombyn-dev` / `Sync-source` wording — outsiders should
   not be able to tell this is a publish pipeline)

Intelligence lives at `apps/intelligence/`.

## Layout

```
apps/intelligence/
apps/web/src/commercial/mockup/
scripts/oss-exclude.paths
scripts/oss-stubs/
docs/commercial/          # internal notes (this file)
```

## Setup

```bash
npm run setup:private-remote
git push origin main
```

Secret on **recombyn-dev**: `PUBLIC_REPO_TOKEN` (write access to `recombyn/zuoge`).

## One-shot history reset (zuoge)

When the public commit log is unusable, rebuild from a clean orphan commit:

```bash
# Disable zuoge branch ruleset briefly (allow force-push), then:
PUBLIC_COMMIT_MESSAGE="$(cat <<'EOF'
fix: upload jobs, strict storage errors, and relocate OSS stubs

Share upload job temp dir with the worker volume.
Surface object-storage failures instead of silent local fallback.
Unify local API port config and add self-host helpers.
EOF
)" GH_TOKEN=… REBUILD_PUSH=1 node scripts/rebuild-public-mirror.mjs
```

Messages are sanitized (no sync/mirror/recombyn-dev). Stars/forks stay on the repo.

## Adding a closed feature

1. Implement under `apps/web/src/commercial/…` or `apps/intelligence/`
2. Wire from `apps/web/src/commercial/…`
3. Add a stub under `scripts/oss-stubs/apps/web/src/commercial/…`
4. Add paths to `scripts/oss-exclude.paths` when there is no public equivalent
