#!/bin/sh
set -eu

cd /app/apps/api

echo "[entrypoint] alembic upgrade head…"
python - <<'PY'
from app.core.db import run_migrations

run_migrations()
print("[entrypoint] migrations ok")
PY

exec "$@"
