#!/usr/bin/env bash
# Refresh /opt/recombyn from zuoge main and redeploy (keep .env + volumes).
set -euo pipefail

ROOT=/opt/recombyn
TMP=/opt/recombyn-oss-fresh
TS=$(date +%Y%m%d%H%M%S)
BK=/opt/recombyn-backups/oss-refresh-$TS

mkdir -p "$BK"
cp -a "$ROOT/.env" "$BK/" 2>/dev/null || true
cp -a "$ROOT/apps/api/.env" "$BK/api.env" 2>/dev/null || true
cp -a "$ROOT/docker-compose.override.yml" "$BK/" 2>/dev/null || true
echo "[1/5] Backup env → $BK"

echo "[2/5] Clone zuoge main → $TMP"
rm -rf "$TMP"
CLONE_OK=0
if git clone --depth 1 --branch main https://github.com/recombyn/zuoge.git "$TMP"; then
  CLONE_OK=1
else
  echo "HTTPS clone failed; trying SSH..."
  if GIT_SSH_COMMAND="ssh -o BatchMode=yes -o StrictHostKeyChecking=yes" \
    git clone --depth 1 --branch main git@github.com:recombyn/zuoge.git "$TMP"; then
    CLONE_OK=1
  fi
fi
if [[ "$CLONE_OK" != 1 ]]; then
  echo "Clone failed"
  exit 1
fi
git -C "$TMP" log -1 --oneline
git -C "$TMP" rev-parse HEAD

echo "[3/5] Stop app containers (keep data volumes)"
cd "$ROOT"
docker compose -f docker-compose.yml -f docker-compose.prod.yml stop web api worker collab 2>/dev/null || true

echo "[4/5] Swap tree"
OLD="/opt/recombyn-broken-$TS"
mv "$ROOT" "$OLD"
mv "$TMP" "$ROOT"
cp -a "$BK/.env" "$ROOT/.env"
mkdir -p "$ROOT/apps/api"
cp -a "$BK/api.env" "$ROOT/apps/api/.env"
if [[ -f "$BK/docker-compose.override.yml" ]]; then
  cp -a "$BK/docker-compose.override.yml" "$ROOT/docker-compose.override.yml"
fi
# Fix CRLF if any
find "$ROOT/deploy" -type f \( -name '*.sh' -o -name '*.yml' \) -print0 \
  | xargs -0 -r sed -i 's/\r$//' || true

echo "[5/5] Deploy"
cd "$ROOT"
bash deploy/vps/deploy.sh

echo "----"
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --format=%s)"
curl -fsS http://127.0.0.1:8000/api/v1/health || true
echo
echo "Old tree: $OLD"
echo "Env backup: $BK"
echo "DONE"
