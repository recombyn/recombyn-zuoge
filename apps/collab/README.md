# Yjs collaboration WebSocket server

You can turn on live canvas collab with this Yjs WebSocket server. The Python API mints room access (`POST /api/v1/collab/room-token`); this process syncs with `y-websocket`.

## Local

```bash
# from repo root
npm install
npm run dev:collab
```

Env (must match `apps/api`):

| Var | Default |
|-----|---------|
| `COLLAB_TOKEN_SECRET` | `dev-collab-token-secret-change-me` |
| `HOST` / `PORT` | `0.0.0.0` / `1234` |

API: `COLLAB_PUBLIC_WS_URL=ws://127.0.0.1:1234`  
Web: `VITE_COLLAB_ENABLED=true` or editor `?collab=1` (Vite DEV also defaults on).
Offline: web also mounts `y-indexeddb` on the same room id ([docs](https://docs.yjs.dev/getting-started/allowing-offline-editing)).

## Docker / production (WSS)

Compose service `collab` is not exposed publicly. The `web` nginx proxies:

```text
Browser  wss://your.domain/collab/<roomId>?token=…
   → TLS terminator
   → web:80 /collab/
   → collab:1234 /<roomId>
```

Set on the host / compose:

```bash
COLLAB_TOKEN_SECRET='replace-me'
COLLAB_PUBLIC_WS_URL=wss://your.domain/collab
```

See [docs/self-hosting.md](../../docs/self-hosting.md#canvas-multiplayer-yjs--wss).
