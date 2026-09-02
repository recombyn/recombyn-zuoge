#!/usr/bin/env bash
# Unpack locally-uploaded zuoge tarball into /opt/recombyn and redeploy.
set -euo pipefail

ROOT=/opt/recombyn
TS=$(date +%Y%m%d%H%M%S)
BK=/opt/recombyn-backups/oss-refresh-$TS
TGZ=/tmp/zuoge-main.tgz
TMP=/opt/recombyn-oss-fresh

if [[ ! -f "$TGZ" ]]; then
  echo "Missing $TGZ"
  exit 1
fi
ls -lh "$TGZ"

mkdir -p "$BK"
cp -a "$ROOT/.env" "$BK/" 2>/dev/null || true
cp -a "$ROOT/apps/api/.env" "$BK/api.env" 2>/dev/null || true
cp -a "$ROOT/docker-compose.override.yml" "$BK/" 2>/dev/null || true
echo "[1/5] Backup env → $BK"

echo "[2/5] Extract tarball"
rm -rf "$TMP"
mkdir -p "$TMP"
tar -xzf "$TGZ" -C "$TMP" --strip-components=1
# Ensure git identity for ops (optional shallow init)
cd "$TMP"
if [[ ! -d .git ]]; then
  git init -b main
  git remote add origin https://github.com/recombyn/zuoge.git
  git add -A
  git -c user.name=recombyn -c user.email=deploy@local commit -m "deploy: zuoge snapshot from tarball"
fi
test -f deploy/vps/deploy.sh
find deploy -type f \( -name '*.sh' -o -name '*.yml' \) -print0 | xargs -0 -r sed -i 's/\r$//' || true

echo "[3/5] Stop app containers"
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

echo "[5/5] Deploy (build)"
cd "$ROOT"
nohup bash deploy/vps/deploy.sh >/tmp/oss-deploy.log 2>&1 &
echo "PID=$!"
# Poll health up to ~25 min
ok=0
for i in $(seq 1 100); do
  if grep -q '\[deploy\] OK' /tmp/oss-deploy.log 2>/dev/null; then
    ok=1
    break
  fi
  if grep -q 'API did not become healthy' /tmp/oss-deploy.log 2>/dev/null; then
    tail -80 /tmp/oss-deploy.log
    exit 1
  fi
  sleep 15
  if (( i % 4 == 0 )); then
    echo "... still building ($((i*15))s)"
    tail -3 /tmp/oss-deploy.log 2>/dev/null || true
  fi
done
tail -40 /tmp/oss-deploy.log
if [[ "$ok" != 1 ]]; then
  echo "Timed out waiting for deploy OK"
  exit 1
fi
echo "----"
curl -fsS http://127.0.0.1:8000/api/v1/health || true
echo
curl -fsSI http://127.0.0.1:3000/ | head -5 || true
echo "Old tree: $OLD"
echo "Env backup: $BK"
echo "DONE"
