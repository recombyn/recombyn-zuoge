# Commercial tree (recombyn-dev)

Closed-source product code for the private monorepo. Not published to `recombyn/zuoge`.

## Layout

```
apps/intelligence/              # Design Intelligence HTTP service (port 8091)
apps/web/src/commercial/mockup/ # @commercial/* mockup UI modules
docs/commercial/                # internal developer notes (this folder)
scripts/oss-exclude.paths       # paths stripped on public mirror sync
```

## Intelligence

```bash
cd apps/intelligence
python scripts/bootstrap_protocol.py
npm run dev:intelligence    # or: npm run dev:stack
```

API auto-sets `RECOMBYN_INTELLIGENCE_URL=http://127.0.0.1:8091` when this tree exists.

Docker: `docker compose -f docker-compose.yml -f docker-compose.intelligence.yml --profile intelligence up`

## Web modules

| Path | Description |
|------|-------------|
| `apps/web/src/commercial/mockup/` | Mockup session UI |

Wiring: `apps/web/src/commercial/editorHosts.tsx` + `@commercial/*` alias.

Internal sync notes: [private-sync.md](./private-sync.md).
