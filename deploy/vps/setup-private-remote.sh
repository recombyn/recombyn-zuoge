#!/usr/bin/env bash
set -euo pipefail

KEY=/opt/recombyn/.deploy/github_deploy
mkdir -p /opt/recombyn/.deploy
if [ ! -f "$KEY" ]; then
  ssh-keygen -t ed25519 -N "" -f "$KEY" -C "recombyn-vps-deploy"
fi
chmod 600 "$KEY"
chmod 644 "$KEY.pub"

mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
ssh-keyscan -t ed25519,rsa github.com >> "$HOME/.ssh/known_hosts" 2>/dev/null || true
sort -u "$HOME/.ssh/known_hosts" -o "$HOME/.ssh/known_hosts"

# SSH config for this key when talking to github.com
mkdir -p "$HOME/.ssh"
cat > "$HOME/.ssh/config" <<EOF
Host github.com
  HostName github.com
  User git
  IdentityFile $KEY
  IdentitiesOnly yes
EOF
chmod 600 "$HOME/.ssh/config"

echo "===PUBKEY==="
cat "$KEY.pub"
