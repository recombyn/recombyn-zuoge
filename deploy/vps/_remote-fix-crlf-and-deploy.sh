#!/usr/bin/env bash
set -euo pipefail
cd /opt/recombyn

python3 <<'PY'
from pathlib import Path

root = Path("/opt/recombyn")
exts = {".sh", ".py", ".yml", ".yaml", ".toml", ".json", ".md", ".example", ".env"}
for p in root.rglob("*"):
    if not p.is_file():
        continue
    name = p.name
    if p.suffix not in exts and not name.startswith("Dockerfile") and not name.endswith(".sh"):
        continue
    try:
        data = p.read_bytes()
    except OSError:
        continue
    if b"\r" not in data:
        continue
    p.write_bytes(data.replace(b"\r\n", b"\n").replace(b"\r", b"\n"))
    print("fixed", p.relative_to(root))
PY

echo "---- deploy.sh shebang check ----"
head -1 deploy/vps/deploy.sh | od -c | head -1

nohup bash deploy/vps/deploy.sh >/tmp/oss-deploy.log 2>&1 &
echo "PID=$!"
sleep 5
tail -60 /tmp/oss-deploy.log
