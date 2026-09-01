#!/usr/bin/env bash
# Switch /opt/recombyn from private recombyn-dev to public zuoge (OSS), keep volumes + .env.
set -euo pipefail

ROOT=/opt/recombyn
TS=$(date +%Y%m%d%H%M%S)
BK=/opt/recombyn-backups/oss-switch-$TS
OSS_URL=https://github.com/recombyn/zuoge.git
OSS_REF=main

mkdir -p "$BK"
cp -a "$ROOT/.env" "$BK/" 2>/dev/null || true
cp -a "$ROOT/apps/api/.env" "$BK/api.env" 2>/dev/null || true
cp -a "$ROOT/docker-compose.override.yml" "$BK/" 2>/dev/null || true
echo "[1/5] Backup env → $BK"

cd "$ROOT"
echo "[2/5] Stop app containers (keep mysql/redis/minio volumes)"
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop web api worker collab 2>/dev/null || true
# intelligence optional
docker compose -f docker-compose.yml -f docker-compose.intelligence.yml --profile intelligence stop 2>/dev/null || true

echo "[3/5] Move old tree aside and clone zuoge"
PARENT="$(dirname "$ROOT")"
OLD="$PARENT/recombyn-private-$TS"
sudo mv "$ROOT" "$OLD" 2>/dev/null || mv "$ROOT" "$OLD"
git clone --depth 1 --branch "$OSS_REF" "$OSS_URL" "$ROOT"
cd "$ROOT"

echo "[4/5] Restore secrets / overrides"
cp -a "$BK/.env" "$ROOT/.env"
mkdir -p "$ROOT/apps/api"
cp -a "$BK/api.env" "$ROOT/apps/api/.env"
if [[ -f "$BK/docker-compose.override.yml" ]]; then
  cp -a "$BK/docker-compose.override.yml" "$ROOT/docker-compose.override.yml"
fi

# Point git remote for future pulls
git remote -v

echo "[5/5] Deploy compose (prod)"
bash deploy/vps/deploy.sh

echo "----"
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --format=%s)"
echo "health:"
curl -fsS http://127.0.0.1:8000/api/v1/health || true
echo
echo "Old private tree kept at: $OLD"
echo "Env backup: $BK"
