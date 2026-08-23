# ADR 0003: Yjs collab as a separate Node service

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Multiplayer editing needs a realtime sync plane distinct from the REST/Design Agent API (different scaling, auth token, and persistence concerns).

## Decision

Run **`apps/collab`** as a dedicated Node WebSocket server (Yjs). The web editor connects via `y-websocket` / room providers; the Python API issues/validates collab tokens (`COLLAB_TOKEN_SECRET`) and advertises `COLLAB_PUBLIC_WS_URL`.

Business project documents remain in the API DB; Yjs holds the live collaborative CRDT room. Local stack: `npm run dev:stack` (web + collab).

## Consequences

### Positive

- Collab can scale/restart independently of uvicorn workers.
- Clear security boundary (short-lived collab tokens).

### Negative / trade-offs

- Two processes to run locally (plus optional API).
- Eventual consistency between durable project snapshots and Yjs rooms must be designed carefully (future ADR if splitting DBs).

## Alternatives considered

1. **Embed Yjs inside FastAPI** — rejected; couples WS fanout to Python workers.
2. **Third-party Hocuspocus Cloud only** — rejected for self-host OSS path.

## References

- `apps/collab/server.mjs`
- `docs/self-hosting.md`
