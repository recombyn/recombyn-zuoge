# Commercial / closed-source tree

Proprietary code lives here in **recombyn-dev**. The OSS mirror (`recombyn/recombyn`) never receives this folder.

## Layout

```
src/commercial/
  web/          # React modules loaded via @commercial/* (lazy / dynamic import)
  api/          # FastAPI routers, intelligence adapters (future)
```

## Current modules

| Path | Description |
|------|-------------|
| `web/mockup/` | Mockup session UI + render helpers |

OSS stubs under `apps/web/src` import `@commercial/...` with `.catch()` fallbacks so the open tree still builds when this folder is absent.

## Deprecated

`apps/web/src/private/` — local-only override directory (gitignored). Prefer `src/commercial/web/` for anything that should ship in the private repo.

## Sync

Push to **recombyn-dev** `main` → GitHub Actions strips `src/commercial/` → updates public **recombyn**.

See [docs/private-sync.md](../docs/private-sync.md).
