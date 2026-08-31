#!/usr/bin/env bash
# Deploy full stack on VPS with public URLs under http://43.143.230.24/
set -euo pipefail

ROOT=/opt/recombyn
IP=43.143.230.24
BASE="http://${IP}"
cd "$ROOT"

echo "[1/6] Sync code from origin/main (expect recombyn-dev)"
git checkout -- apps/api/app/crud.py 2>/dev/null || true
git fetch origin
git reset --hard origin/main
echo "HEAD=$(git rev-parse --short HEAD) $(git log -1 --format=%s)"

set_kv() {
  local file="$1" key="$2" val="$3"
  touch "$file"
  if grep -q "^${key}=" "$file" 2>/dev/null; then
    # Escape sed specials in val minimally
    local esc
    esc=$(printf '%s' "$val" | sed -e 's/[\/&]/\\&/g')
    sed -i "s|^${key}=.*|${key}=${esc}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

echo "[2/6] Point public URLs to ${BASE}"
for f in .env apps/api/.env; do
  set_kv "$f" S3_PUBLIC_BASE_URL "${BASE}/recombyn"
  set_kv "$f" PUBLIC_APP_BASE_URL "${BASE}"
  set_kv "$f" COLLAB_PUBLIC_WS_URL "ws://${IP}/collab"
  set_kv "$f" CORS_ORIGINS "[\"${BASE}\",\"${BASE}:3000\",\"http://${IP}\",\"https://recombyn.com\",\"https://www.recombyn.com\"]"
done

# Compose root .env also drives docker-compose.prod.yml substitution
set_kv .env CORS_ORIGINS "[\"${BASE}\",\"${BASE}:3000\",\"http://${IP}\",\"https://recombyn.com\",\"https://www.recombyn.com\"]"

# Keep override collab on IP ws (not wss domain)
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

echo "[3/6] Caddy: serve app + MinIO path-style under same IP"
sudo tee /etc/caddy/Caddyfile >/dev/null <<'EOF'
# HTTP by IP — app + MinIO objects under /recombyn/*
http://43.143.230.24 {
	encode gzip

	# Path-style S3 public URLs: http://43.143.230.24/recombyn/<key>
	handle /recombyn* {
		reverse_proxy 127.0.0.1:9000
	}

	reverse_proxy 127.0.0.1:3000
}

# Keep domain + files subdomain for existing DNS clients
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

echo "[4/6] Ensure ILP / intelligence env"
if [ -f deploy/vps/enable-ilp.sh ]; then
  bash deploy/vps/enable-ilp.sh || true
fi
# Re-apply IP URLs after enable-ilp (it may not touch them)
for f in .env apps/api/.env; do
  set_kv "$f" S3_PUBLIC_BASE_URL "${BASE}/recombyn"
  set_kv "$f" PUBLIC_APP_BASE_URL "${BASE}"
  set_kv "$f" COLLAB_PUBLIC_WS_URL "ws://${IP}/collab"
done

INTEL_CTX="${RECOMBYN_INTELLIGENCE_CONTEXT:-/opt/recombyn-intelligence}"
export RECOMBYN_INTELLIGENCE_CONTEXT="$INTEL_CTX"

COMPOSE=(sudo docker compose
  -f docker-compose.yml
  -f docker-compose.prod.yml
  -f docker-compose.override.yml
  -f docker-compose.intelligence.yml
  --profile intelligence
)

echo "[5/6] Rebuild & up (full stack + intelligence)"
"${COMPOSE[@]}" up -d --build mysql redis minio minio-init
"${COMPOSE[@]}" up -d --build intelligence api worker collab web

echo "[6/6] Health checks"
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

echo "=== public via IP ==="
curl -fsSI "${BASE}/" | head -8 || true
echo "=== S3 env in api ==="
sudo docker exec recombyn-api-1 printenv | grep -E 'S3_PUBLIC|PUBLIC_APP|COLLAB_PUBLIC|CORS' | sort
echo "=== intelligence ==="
curl -fsS http://127.0.0.1:8091/health || echo "(intel health failed)"
echo
echo "DONE — open ${BASE}/"
