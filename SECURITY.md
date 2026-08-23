# Security Policy

## Supported versions

Security fixes are applied on the default branch (`main` / `master`). If you self-host, upgrade to the latest tagged release when available.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security bugs.

Email the maintainers (see repository profile / `SECURITY` contact when published), and include:

- Affected component (`apps/web`, `apps/api`, deploy compose, …)
- Reproduction steps or PoC (non-destructive preferred)
- Impact assessment (auth bypass, data leak, RCE, …)

We aim to acknowledge reports within **7 days** and coordinate a fix or advisory before any public disclosure.

## Self-host hardening (checklist)

See [docs/self-hosting.md](docs/self-hosting.md). At minimum:

- Change MySQL and `SUPER_ADMIN_BOOTSTRAP_PASSWORD` defaults
- Rotate `CARD_KEY_SALT` / provider API keys
- Never commit `.env` files
- Terminate TLS in front of the stack
- Set `LOG_JSON=true` in production log drains (ADR 0007); keep `install_log_redaction` on
- Prefer correlating incidents with `X-Trace-Id` / hydrate `trace_id`
- Upload policy: magic-byte match on (ADR 0008); optional `UPLOAD_AV_HOOK_ENABLED` + `UPLOAD_AV_COMMAND`
  - Compose ClamAV: `docker compose --profile av -f docker-compose.yml -f docker-compose.av.yml up -d --build`
- Optional OpenTelemetry: `pip install -e '.[otel]'` + `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` (ADR 0011)

## Authorization

Coarse `user` / `admin` roles today — see [docs/security-rbac.md](docs/security-rbac.md).

CI runs `pip-audit` (API) and `npm audit --audit-level=high` (workspaces) on a soft gate
(`.github/workflows/dependency-audit.yml`). Treat new highs as merge blockers once the backlog is green.
