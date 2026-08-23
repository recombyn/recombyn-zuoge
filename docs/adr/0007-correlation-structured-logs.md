# ADR 0007: Correlation + structured logs (OTel later)

- **Status:** Accepted
- **Date:** 2026-08-12

## Context

Phase 3 needs API → Celery observability. We already have Prometheus `/metrics`, Grafana, and log redaction, but hydrate jobs cannot be joined across enqueue and worker logs. Full OpenTelemetry SDK is valuable later; shipping it before a correlation contract adds agent weight without fixing the Phase-2 async path.

## Decision

1. **Correlation id:** app-level `trace_id` (hex / safe slug, ≤64 chars). Accept from `X-Trace-Id` / `X-Request-Id` or body; otherwise mint. Persist on Redis job records; echo on HTTP responses as `X-Trace-Id`.
2. **First vertical:** design hydrate jobs + apply-path Celery hydrate (`job_id` + `trace_id` on every stage log / metric-adjacent log line).
3. **Structured logs:** optional `LOG_JSON=true` → JSON lines on stdout (`ts`, `level`, `logger`, `msg`, plus `trace_id` / `job_id` / `event` when present). Default remains human text for local DX. Existing `install_log_redaction()` stays on.
4. **OTel:** optional SDK via ADR 0011 (`.[otel]` + `OTEL_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT`); this ADR keeps the app-level `trace_id` contract.
5. **Alerts:** extend Prometheus rules with hydrate failure rate; dependency audit CI is a separate lightweight gate (pip-audit / npm audit).

## Consequences

### Positive

- Join API enqueue ↔ worker finish without a new service.
- JSON toggle is ops-friendly for log drains.

### Negative / trade-offs

- Not W3C `traceparent` / full OTel by itself — see ADR 0011 for optional SDK.
- Metrics stay low-cardinality (no `trace_id` label).

## Alternatives considered

1. **OTel SDK now** — deferred to ADR 0011 as an optional extra.
2. **Only CI dep-audit** — useful but does not fix async correlation.
3. **Per-request span store in Redis** — overkill vs job payload field.

## References

- [ADR 0005](./0005-async-job-boundary.md)
- `apps/api/app/services/job_store.py`
- `deploy/observability/prometheus/rules/recombyn.yml`
- [Roadmap Phase 3](../roadmap/platform.md)
