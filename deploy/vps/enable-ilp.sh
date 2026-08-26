#!/usr/bin/env bash
set -euo pipefail
cd /opt/recombyn

KEY="$(grep -E '^RECOMBYN_INTELLIGENCE_API_KEY=' .env | cut -d= -f2- | head -1)"
KEY="${KEY:-r8cvxa37hmp9nuk64boqt0zl1jgef2ids5wy}"

if ! grep -q '^IMAGE_LAYER_PIPELINE_URL=' .env; then
  cat >> .env <<EOF

# Closed-source ILP (removeBg / upscale / editElements) via intelligence
IMAGE_LAYER_PIPELINE_URL=http://intelligence:8091
IMAGE_LAYER_PIPELINE_API_KEY=${KEY}
IMAGE_LAYER_PIPELINE_MODE=ilp
IMAGE_LAYER_PIPELINE_TIMEOUT_SEC=300
EOF
fi

API_ENV=apps/api/.env
touch "$API_ENV"
set_kv() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$API_ENV"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$API_ENV"
  else
    echo "${k}=${v}" >> "$API_ENV"
  fi
}

set_kv RECOMBYN_INTELLIGENCE_MODE cloud
set_kv RECOMBYN_INTELLIGENCE_URL http://intelligence:8091
set_kv RECOMBYN_INTELLIGENCE_API_KEY "$KEY"
set_kv IMAGE_LAYER_PIPELINE_URL http://intelligence:8091
set_kv IMAGE_LAYER_PIPELINE_API_KEY "$KEY"
set_kv IMAGE_LAYER_PIPELINE_MODE ilp
set_kv IMAGE_LAYER_PIPELINE_TIMEOUT_SEC 300

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.override.yml)
"${COMPOSE[@]}" up -d api worker

echo "waiting..."
for i in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8000/api/v1/image/tools >/tmp/tools.json 2>/dev/null; then
    break
  fi
  sleep 2
done

echo "=== local tools.ilp ==="
python3 -c "import json; print(json.load(open('/tmp/tools.json')).get('ilp'))"
echo "=== container env ==="
sudo docker exec recombyn-api-1 printenv | grep -E 'IMAGE_LAYER|INTELLIGENCE' | sort
echo "=== public tools.ilp ==="
curl -fsS https://recombyn.com/api/v1/image/tools | python3 -c "import sys,json; print(json.load(sys.stdin).get('ilp'))"
