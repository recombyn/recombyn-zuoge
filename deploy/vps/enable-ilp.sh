#!/usr/bin/env bash
set -euo pipefail
cd /opt/recombyn

KEY="$(grep -E '^RECOMBYN_INTELLIGENCE_API_KEY=' .env | cut -d= -f2- | head -1 || true)"
KEY="${KEY#"${KEY%%[![:space:]]*}"}"
KEY="${KEY%"${KEY##*[![:space:]]}"}"
if [ -z "$KEY" ]; then
  echo "RECOMBYN_INTELLIGENCE_API_KEY missing in /opt/recombyn/.env" >&2
  exit 1
fi

set_kv() {
  local file="$1" key="$2" val="$3"
  touch "$file"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

API_ENV=apps/api/.env
INTEL_ENV="${RECOMBYN_INTELLIGENCE_CONTEXT:-/opt/recombyn-intelligence}/.env"
ILP_VARS=(
  "RECOMBYN_INTELLIGENCE_MODE=cloud"
  "RECOMBYN_INTELLIGENCE_URL=http://intelligence:8091"
  "RECOMBYN_INTELLIGENCE_API_KEY=${KEY}"
  "IMAGE_LAYER_PIPELINE_URL=http://intelligence:8091"
  "IMAGE_LAYER_PIPELINE_API_KEY=${KEY}"
  "IMAGE_LAYER_PIPELINE_MODE=ilp"
  "IMAGE_LAYER_PIPELINE_TIMEOUT_SEC=300"
)

for entry in "${ILP_VARS[@]}"; do
  set_kv .env "${entry%%=*}" "${entry#*=}"
  set_kv "$API_ENV" "${entry%%=*}" "${entry#*=}"
done

if [ -f "$INTEL_ENV" ]; then
  set_kv "$INTEL_ENV" INTELLIGENCE_SERVICE_API_KEY "$KEY"
  echo "[enable-ilp] synced INTELLIGENCE_SERVICE_API_KEY in ${INTEL_ENV}"
fi

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.override.yml)
"${COMPOSE[@]}" up -d api worker

echo "waiting..."
for _ in $(seq 1 30); do
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
curl -fsS https://recombyn.com/api/v1/image/tools 2>/dev/null \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('ilp'))" \
  || echo "(public check skipped)"
