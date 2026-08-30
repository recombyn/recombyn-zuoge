#!/usr/bin/env bash
# Point /opt/recombyn at closed-source recombyn/recombyn-dev and redeploy.
set -euo pipefail

ROOT=/opt/recombyn
IP=43.143.230.24
BASE="http://${IP}"
KEY=/opt/recombyn/.deploy/github_deploy
BACKUP=/tmp/recombyn-env-backup-$$
cd "$ROOT"

echo "[0] Backup secrets / override"
mkdir -p "$BACKUP"
cp -a .env "$BACKUP/" 2>/dev/null || true
cp -a apps/api/.env "$BACKUP/api.env" 2>/dev/null || true
cp -a docker-compose.override.yml "$BACKUP/" 2>/dev/null || true
# keep deploy key dir out of git wipe
mkdir -p .deploy

echo "[1] Switch origin -> git@github.com:recombyn/recombyn-dev.git"
git remote remove origin 2>/dev/null || true
git remote add origin git@github.com:recombyn/recombyn-dev.git
export GIT_SSH_COMMAND="ssh -i ${KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes"
git fetch origin
git checkout -- apps/api/app/crud.py 2>/dev/null || true
git reset --hard origin/main
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --format=%s)"
echo "remote=$(git remote get-url origin)"

echo "[2] Restore secrets"
if [ -f "$BACKUP/.env" ]; then cp -a "$BACKUP/.env" .env; fi
if [ -f "$BACKUP/api.env" ]; then
  mkdir -p apps/api
  cp -a "$BACKUP/api.env" apps/api/.env
fi

set_kv() {
  local file="$1" key="$2" val="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    local esc
    esc=$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${esc}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "[3] Point public URLs to ${BASE}"
for f in .env apps/api/.env; do
  set_kv "$f" S3_PUBLIC_BASE_URL "${BASE}/recombyn"
  set_kv "$f" PUBLIC_APP_BASE_URL "${BASE}"
  set_kv "$f" COLLAB_PUBLIC_WS_URL "ws://${IP}/collab"
  set_kv "$f" CORS_ORIGINS "[\"${BASE}\",\"${BASE}:3000\",\"http://${IP}\",\"https://recombyn.com\",\"https://www.recombyn.com\"]"
done

cat > docker-compose.override.yml <<'EOF'
services:
  api:
    environment:
      - SUPER_ADMIN_TEST_CODE=
      - AUTH_CONSOLE_LOGIN_CODE=false
      - WALLET_BILLING_ENABLED=true
      - COLLAB_PUBLIC_WS_URL=ws://43.143.230.24/collab
      - PUBLIC_APP_BASE_URL=http://43.143.230.24
      - S3_PUBLIC_BASE_URL=http://43.143.230.24/recombyn
      - CORS_ORIGINS=["http://43.143.230.24","http://43.143.230.24:3000","https://recombyn.com","https://www.recombyn.com"]
  worker:
    environment:
      - SUPER_ADMIN_TEST_CODE=
      - AUTH_CONSOLE_LOGIN_CODE=false
      - WALLET_BILLING_ENABLED=true
      - S3_PUBLIC_BASE_URL=http://43.143.230.24/recombyn
EOF

echo "[4] Caddy (IP + domain)"
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
http://43.143.230.24 {
	encode gzip
	handle /recombyn* {
		reverse_proxy 127.0.0.1:9000
	}
	reverse_proxy 127.0.0.1:3000
}

files.recombyn.com {
	encode gzip
	reverse_proxy 127.0.0.1:9000
}

recombyn.com, www.recombyn.com {
	encode gzip
	header {
		X-Content-Type-Options nosniff
		X-Frame-Options SAMEORIGIN
		Referrer-Policy strict-origin-when-cross-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
		-Server
	}
	handle /recombyn* {
		reverse_proxy 127.0.0.1:9000
	}
	reverse_proxy 127.0.0.1:3000
}
EOF
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy

if [ -f deploy/vps/enable-ilp.sh ]; then
  bash deploy/vps/enable-ilp.sh || true
fi
for f in .env apps/api/.env; do
  set_kv "$f" S3_PUBLIC_BASE_URL "${BASE}/recombyn"
  set_kv "$f" PUBLIC_APP_BASE_URL "${BASE}"
  set_kv "$f" COLLAB_PUBLIC_WS_URL "ws://${IP}/collab"
done

# Prefer external intelligence checkout (models/weights); fall back to in-tree.
INTEL_CTX="${RECOMBYN_INTELLIGENCE_CONTEXT:-}"
if [ -z "$INTEL_CTX" ]; then
  if [ -d /opt/recombyn-intelligence ]; then
    INTEL_CTX=/opt/recombyn-intelligence
  else
    INTEL_CTX=./apps/intelligence
  fi
fi
export RECOMBYN_INTELLIGENCE_CONTEXT="$INTEL_CTX"
echo "intelligence context=$RECOMBYN_INTELLIGENCE_CONTEXT"

COMPOSE=(sudo -E docker compose
  -f docker-compose.yml
  -f docker-compose.prod.yml
  -f docker-compose.override.yml
  -f docker-compose.intelligence.yml
  --profile intelligence
)

echo "[5] Rebuild & up (closed-source full stack)"
"${COMPOSE[@]}" up -d --build mysql redis minio minio-init
"${COMPOSE[@]}" up -d --build intelligence api worker collab web

echo "[6] Health"
ok=0
for i in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/tmp/health.json 2>/dev/null; then
    cat /tmp/health.json
    echo
    ok=1
    break
  fi
  sleep 3
done
if [ "$ok" != 1 ]; then
  echo "API unhealthy — logs:"
  "${COMPOSE[@]}" logs api --tail=80
  exit 1
fi

echo "=== git ==="
git remote -v
git log -1 --oneline
echo "=== public via IP ==="
curl -fsSI "${BASE}/" | head -8 || true
echo "=== S3 env in api ==="
sudo docker exec recombyn-api-1 printenv | grep -E 'S3_PUBLIC|PUBLIC_APP|COLLAB_PUBLIC|CORS' | sort
echo "=== intelligence ==="
curl -fsS http://127.0.0.1:8091/health || echo "(intel health failed)"
echo
rm -rf "$BACKUP"
echo "DONE — closed-source at ${BASE}/"
