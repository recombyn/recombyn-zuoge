# Commercial / closed-source tree

Proprietary code lives here in **recombyn-dev**. The OSS mirror (`recombyn/recombyn`) never receives this folder.

## Layout

```
src/commercial/
  intelligence/   # Design Intelligence HTTP service (port 8091)
  web/            # React modules loaded via @commercial/* (lazy import)
  api/            # Future: API-only closed routers
```

## Intelligence (vendored)

Former standalone repo `recombyn-intelligence`, now colocated:

```bash
cd src/commercial/intelligence
python scripts/bootstrap_protocol.py   # venv + editable install
npm run dev:intelligence               # or included in npm run dev:stack
```

API auto-wires `RECOMBYN_INTELLIGENCE_URL=http://127.0.0.1:8091` when this tree exists.

Docker: `docker compose -f docker-compose.yml -f docker-compose.intelligence.yml --profile intelligence up`

## Web modules

| Path | Description |
|------|-------------|
| `web/mockup/` | Mockup session UI + render helpers |

OSS stubs import `@commercial/...` with `.catch()` fallbacks.

## Deprecated

- Separate `recombyn-intelligence` checkout — use `src/commercial/intelligence`
- `apps/web/src/private/` — local-only overrides (gitignored)

## Sync

Push **recombyn-dev** `main` → GitHub Actions strips `src/commercial/` → updates public **recombyn**.

See [docs/private-sync.md](../../docs/private-sync.md).
