#!/usr/bin/env bash
# First-time VPS prep (Ubuntu 22.04+). Run as root once.
set -euo pipefail

apt-get update
apt-get install -y ca-certificates curl git ufw

# Docker Engine + Compose plugin
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
fi

# Caddy (HTTPS)
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[bootstrap] Docker: $(docker --version)"
echo "[bootstrap] Next:"
echo "  git clone <your-private-repo> /opt/recombyn && cd /opt/recombyn"
echo "  cp deploy/vps/.env.production.example .env && nano .env"
echo "  cp apps/api/.env.selfhost.example apps/api/.env && nano apps/api/.env"
echo "  cp deploy/caddy/Caddyfile.recombyn /etc/caddy/Caddyfile && systemctl reload caddy"
echo "  bash deploy/vps/deploy.sh"
