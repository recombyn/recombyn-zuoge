# Production deploy (MySQL + MinIO)

Only production path for VPS. Local see root docs / `npm run setup:local`.

Target: `43.143.230.24` · `recombyn.com` · files `files.recombyn.com`

Same codebase as cloud — `WALLET_BILLING_ENABLED=true` by default in `deploy/vps/.env.production.example`. Configure Tencent SES in `apps/api/.env` for email login.

## Steps

```bash
ssh ubuntu@43.143.230.24
cd /opt/recombyn

# first time only
bash deploy/vps/bootstrap-server.sh

cp deploy/vps/.env.production.example .env && nano .env
# merge Profile Production from apps/api/.env.selfhost.example → apps/api/.env

cp deploy/caddy/Caddyfile.recombyn /etc/caddy/Caddyfile
sudo systemctl reload caddy

bash deploy/vps/deploy.sh
```

DNS: `recombyn.com` / `www` / `files.recombyn.com` → VPS IP.

Health: `curl -s http://127.0.0.1:8000/api/v1/health` → `"dialect":"mysql"`, `"s3":true`.
