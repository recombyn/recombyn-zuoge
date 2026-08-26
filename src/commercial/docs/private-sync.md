# Private → public sync (recombyn-dev → zuoge)

**Internal only** — this file lives under `src/commercial/` and is not published to `recombyn/zuoge`.

**Two repositories only.** Develop in `recombyn-dev`; public `zuoge` is an automated mirror with commercial code **deleted**, not hidden behind runtime flags.

| Remote | GitHub | Role |
|--------|--------|------|
| `origin` | `recombyn/recombyn-dev` | Daily development (full tree) |
| `public` | `recombyn/zuoge` | Public mirror — never push features here |

## How stripping works

On each push to `recombyn-dev` `main`, `sync-public.yml`:

1. `rsync` the full private tree into a clone of public `zuoge`
2. **`sync-public-strip.mjs`** — hard-deletes paths in `src/commercial/oss-exclude.paths`
3. Overlays **`scripts/oss-stubs/`** — empty commercial wiring for the public tree
4. Verifies `src/commercial/` is gone before push
5. Commits to `zuoge` with the **same message as the private commit** (plus `Sync-source: recombyn-dev@<sha>` footer)

Intelligence lives at `src/commercial/intelligence/`.

## Layout

```
src/commercial/
  intelligence/     # Design Intelligence service (8091)
  web/              # @commercial/* modules
  oss-exclude.paths
  docs/             # internal notes (this file)

apps/web/src/commercial/
scripts/oss-stubs/
```

## Setup

```bash
npm run setup:private-remote
git push origin main
```

Secret on **recombyn-dev**: `PUBLIC_REPO_TOKEN` (write access to `recombyn/zuoge`).

## One-shot history reset (zuoge)

When the public mirror commit log is unusable (generic `chore: sync…` spam), rebuild from a clean orphan commit:

```bash
# Disable zuoge branch ruleset briefly (allow force-push), then:
GH_TOKEN=… REBUILD_PUSH=1 node scripts/rebuild-public-mirror.mjs
```

This strips commercial code, creates **one** commit with the current private `HEAD` message (+ `Sync-source:` footer), and force-pushes `main`. Stars/forks stay on the repo; fork owners should `git fetch upstream && git reset --hard upstream/main`.

## Adding a closed feature

1. Implement under `src/commercial/web/…` or `intelligence/`
2. Wire from `apps/web/src/commercial/…`
3. Add a stub under `scripts/oss-stubs/apps/web/src/commercial/…`
4. Add paths to `oss-exclude.paths` when there is no public equivalent
