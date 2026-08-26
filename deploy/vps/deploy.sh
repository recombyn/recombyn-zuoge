#!/usr/bin/env bash
# One-shot (re)deploy on VPS — MySQL + MinIO + full stack.
# Run on the server from repo root after .env and apps/api/.env are configured.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing .env — copy deploy/vps/.env.production.example to .env and edit secrets."
  exit 1
fi

if [[ ! -f apps/api/.env ]]; then
  echo "Missing apps/api/.env — copy apps/api/.env.selfhost.example Profile B and add LLM keys."
  exit 1
fi

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

if [[ -n "${RECOMBYN_TAG:-}" && -f docker-compose.ghcr.yml ]]; then
  COMPOSE+=(-f docker-compose.ghcr.yml)
  echo "[deploy] Using GHCR images tag=${RECOMBYN_TAG}"
  "${COMPOSE[@]}" pull
else
  echo "[deploy] Building images locally..."
fi

"${COMPOSE[@]}" up -d --build mysql redis minio minio-init
"${COMPOSE[@]}" up -d --build api worker collab web

echo "[deploy] Waiting for API health..."
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/dev/null 2>&1; then
    curl -fsS http://127.0.0.1:8000/api/v1/health
    echo
    echo "[deploy] OK — reload Caddy if Caddyfile changed: systemctl reload caddy"
    exit 0
  fi
  sleep 3
done

echo "[deploy] API did not become healthy in time — check: docker compose logs api --tail=100"
exit 1
