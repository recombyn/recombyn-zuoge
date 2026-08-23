# Private → public sync (recombyn-dev → recombyn)

**Internal only** — this file lives under `src/commercial/` and is not published to `recombyn/recombyn`.

**Two repositories only.** Develop in `recombyn-dev`; public `recombyn` is an automated mirror with commercial code **deleted**, not hidden behind runtime flags.

| Remote | GitHub | Role |
|--------|--------|------|
| `origin` | `recombyn/recombyn-dev` | Daily development (full tree) |
| `public` | `recombyn/recombyn` | Public mirror — never push features here |

## How stripping works

On each push to `recombyn-dev` `main`, `sync-public.yml`:

1. `rsync` the full private tree into a clone of public `recombyn`
2. **`sync-public-strip.mjs`** — hard-deletes paths in `src/commercial/oss-exclude.paths`
3. Overlays **`oss-stubs/`** — empty commercial wiring for the public tree
4. Verifies `src/commercial/` is gone before push

Intelligence lives at `src/commercial/intelligence/`.

## Layout

```
src/commercial/
  intelligence/     # Design Intelligence service (8091)
  web/              # @commercial/* modules
  oss-exclude.paths
  docs/             # internal notes (this file)

apps/web/src/commercial/
oss-stubs/
```

## Setup

```bash
npm run setup:private-remote
git push origin main
```

Secret on **recombyn-dev**: `PUBLIC_REPO_TOKEN` (write access to `recombyn/recombyn`).

## Adding a closed feature

1. Implement under `src/commercial/web/…` or `intelligence/`
2. Wire from `apps/web/src/commercial/…`
3. Add a stub under `oss-stubs/apps/web/src/commercial/…`
4. Add paths to `oss-exclude.paths` when there is no public equivalent

