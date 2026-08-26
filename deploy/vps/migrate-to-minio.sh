#!/usr/bin/env bash
set -euo pipefail
cd /opt/recombyn

if ! grep -q '^MINIO_ROOT_USER=' .env 2>/dev/null; then
  MINIO_PASS="$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)"
  cat >> .env <<EOF

# MinIO (self-hosted S3)
MINIO_ROOT_USER=recombyn-minio
MINIO_ROOT_PASSWORD=${MINIO_PASS}
MINIO_BUCKET=recombyn
S3_ENABLED=true
S3_ENDPOINT_URL=http://minio:9000
S3_ACCESS_KEY=recombyn-minio
S3_SECRET_KEY=${MINIO_PASS}
S3_BUCKET=recombyn
S3_REGION=us-east-1
S3_PUBLIC_BASE_URL=https://files.recombyn.com/recombyn
S3_ADDRESSING_STYLE=path
S3_ACL_PUBLIC_READ=true
DATABASE_URL=mysql://recombyn:recombyn@mysql:3306/recombyn
EOF
fi

cp apps/api/.env "apps/api/.env.bak.$(date +%Y%m%d%H%M%S)"

set_kv() {
  local key="$1" val="$2" file="apps/api/.env"
  if grep -q "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${val}|" "$file"
  else
    echo "${key}=${val}" >> "$file"
  fi
}

S3AK="$(grep '^S3_ACCESS_KEY=' .env | cut -d= -f2-)"
S3SK="$(grep '^S3_SECRET_KEY=' .env | cut -d= -f2-)"

set_kv DATABASE_URL 'mysql://recombyn:recombyn@mysql:3306/recombyn'
set_kv S3_ENABLED 'true'
set_kv S3_ENDPOINT_URL 'http://minio:9000'
set_kv S3_ACCESS_KEY "$S3AK"
set_kv S3_SECRET_KEY "$S3SK"
set_kv S3_BUCKET 'recombyn'
set_kv S3_REGION 'us-east-1'
set_kv S3_PUBLIC_BASE_URL 'https://files.recombyn.com/recombyn'
set_kv S3_ADDRESSING_STYLE 'path'
set_kv S3_ACL_PUBLIC_READ 'true'

grep -q 'Tencent COS/CynosDB disabled' apps/api/.env || \
  echo '# Tencent COS/CynosDB disabled — local MySQL + MinIO' >> apps/api/.env

sudo cp deploy/caddy/Caddyfile.recombyn /etc/caddy/Caddyfile
sudo systemctl reload caddy

COMPOSE=(sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.override.yml)

"${COMPOSE[@]}" up -d mysql redis minio minio-init
"${COMPOSE[@]}" up -d --build api worker web collab

for i in $(seq 1 48); do
  if curl -fsS http://127.0.0.1:8000/api/v1/health >/tmp/h.json 2>/dev/null; then
    cat /tmp/h.json
    echo
    exit 0
  fi
  sleep 5
done

echo "health check timeout"
sudo docker compose logs api --tail=60
exit 1
