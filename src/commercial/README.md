# Commercial tree (recombyn-dev)

Closed-source product code for the private monorepo. Not published to `recombyn/recombyn`.

## Layout

```
src/commercial/
  intelligence/   # Design Intelligence HTTP service (port 8091)
  web/            # @commercial/* UI modules (mockup, …)
  docs/           # internal developer notes
```

## Intelligence

```bash
cd src/commercial/intelligence
python scripts/bootstrap_protocol.py
npm run dev:intelligence    # or: npm run dev:stack
```

API auto-sets `RECOMBYN_INTELLIGENCE_URL=http://127.0.0.1:8091` when this tree exists.

Docker: `docker compose -f docker-compose.yml -f docker-compose.intelligence.yml --profile intelligence up`

## Web modules

| Path | Description |
|------|-------------|
| `web/mockup/` | Mockup session UI |

Wiring: `apps/web/src/commercial/` + `@commercial/*` alias.

Internal sync notes: [docs/private-sync.md](./docs/private-sync.md).
