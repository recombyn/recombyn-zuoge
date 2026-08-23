"""Prometheus metrics — single scrape surface for Gate B (k6 + Grafana).

HTTP RED: prometheus-fastapi-instrumentator → GET /metrics
Domain: counters/histograms/gauges in this module
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from prometheus_client import Counter, Gauge, Histogram

if TYPE_CHECKING:
    from fastapi import FastAPI

logger = logging.getLogger(__name__)

DESIGN_RUNS_TOTAL = Counter(
    "recombyn_design_runs_total",
    "Design Agent /run requests accepted",
    ["run_mode"],
)

DESIGN_RUN_OUTCOMES_TOTAL = Counter(
    "recombyn_design_run_outcomes_total",
    "Design Agent run terminal outcomes (when observed)",
    ["outcome"],
)

DESIGN_RUN_DURATION_SECONDS = Histogram(
    "recombyn_design_run_duration_seconds",
    "Design Agent run wall time when observed",
    buckets=(1.0, 5.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0),
)

DEP_REDIS_UP = Gauge("recombyn_dependency_redis_up", "1 if Redis ping succeeds")
DEP_DB_UP = Gauge("recombyn_dependency_db_up", "1 if DB SELECT 1 succeeds")
DEP_WORKER_UP = Gauge(
    "recombyn_dependency_worker_up", "1 if Celery worker ping succeeds"
)

HYDRATE_JOBS_TOTAL = Counter(
    "recombyn_hydrate_jobs_total",
    "Design image hydrate jobs enqueued or finished",
    ["event"],
)

HYDRATE_DLQ_TOTAL = Counter(
    "recombyn_hydrate_dlq_total",
    "Hydrate jobs pushed to Redis DLQ after terminal failure",
)

HYDRATE_DLQ_DEPTH = Gauge(
    "recombyn_hydrate_dlq_depth",
    "Current Redis hydrate DLQ list length (recombyn:dlq:hydrate)",
)

EXPORT_JOBS_TOTAL = Counter(
    "recombyn_export_jobs_total",
    "Design artboard export jobs enqueued or finished",
    ["event"],
)

EXPORT_DLQ_TOTAL = Counter(
    "recombyn_export_dlq_total",
    "Export jobs pushed to Redis DLQ after terminal failure",
)

EXPORT_DLQ_DEPTH = Gauge(
    "recombyn_export_dlq_depth",
    "Current Redis export DLQ list length (recombyn:dlq:export)",
)

IMAGE_JOBS_TOTAL = Counter(
    "recombyn_image_jobs_total",
    "Chat image-generation jobs enqueued or finished",
    ["event"],
)

VIDEO_JOBS_TOTAL = Counter(
    "recombyn_video_jobs_total",
    "Chat video-generation jobs enqueued or finished",
    ["event"],
)

AUDIO_JOBS_TOTAL = Counter(
    "recombyn_audio_jobs_total",
    "Chat audio-generation jobs enqueued or finished",
    ["event"],
)


def observe_job(kind: str, event: str) -> None:
    """event: enqueued | done | failed | retry | dlq."""
    counters = {
        "hydrate": HYDRATE_JOBS_TOTAL,
        "export": EXPORT_JOBS_TOTAL,
        "image": IMAGE_JOBS_TOTAL,
        "video": VIDEO_JOBS_TOTAL,
        "audio": AUDIO_JOBS_TOTAL,
    }
    counter = counters.get(str(kind or "").strip().lower())
    if counter is None:
        return
    try:
        counter.labels(event=(event or "unknown")[:32]).inc()
    except Exception:
        logger.debug("%s job metric failed", kind, exc_info=True)


def observe_dlq(kind: str) -> None:
    totals = {"hydrate": HYDRATE_DLQ_TOTAL, "export": EXPORT_DLQ_TOTAL}
    total = totals.get(str(kind or "").strip().lower())
    if total is None:
        return
    try:
        total.inc()
    except Exception:
        logger.debug("%s dlq metric failed", kind, exc_info=True)


def observe_design_run_start(run_mode: str = "agent") -> None:
    try:
        DESIGN_RUNS_TOTAL.labels(run_mode=(run_mode or "agent")[:32]).inc()
    except Exception:
        logger.debug("design run start metric failed", exc_info=True)


def observe_design_run_outcome(outcome: str, duration_s: float | None = None) -> None:
    try:
        DESIGN_RUN_OUTCOMES_TOTAL.labels(outcome=(outcome or "unknown")[:32]).inc()
        if duration_s is not None and duration_s >= 0:
            DESIGN_RUN_DURATION_SECONDS.observe(duration_s)
    except Exception:
        logger.debug("design run outcome metric failed", exc_info=True)


_last_dep_gauge_refresh = 0.0
_DEP_GAUGE_TTL_SEC = 30.0


def refresh_dependency_gauges(*, force: bool = False) -> None:
    """Best-effort snapshot for Grafana (before /metrics scrape).

    DLQ depth is cheap (Redis LLEN) and refreshes every scrape.
    Redis/DB/worker probes are throttled — Celery inspect alone can take ~1s+.
    """
    global _last_dep_gauge_refresh
    import time

    try:
        from app.services.job_store import dlq_depth

        HYDRATE_DLQ_DEPTH.set(float(dlq_depth("hydrate")))
        EXPORT_DLQ_DEPTH.set(float(dlq_depth("export")))
    except Exception:
        logger.debug("job dlq depth gauge failed", exc_info=True)

    now = time.monotonic()
    if not force and (now - _last_dep_gauge_refresh) < _DEP_GAUGE_TTL_SEC:
        return
    _last_dep_gauge_refresh = now
    try:
        from app.api.routes.health import _check_db, _check_redis, _check_worker

        redis_ok = _check_redis()
        DEP_REDIS_UP.set(1 if redis_ok else 0)
        DEP_WORKER_UP.set(1 if (redis_ok and _check_worker()) else 0)
        db = _check_db()
        DEP_DB_UP.set(1 if db.get("ok") else 0)
    except Exception:
        logger.debug("dependency gauge refresh failed", exc_info=True)


def setup_metrics(app: "FastAPI") -> None:
    """Instrument HTTP RED and expose GET /metrics (Prometheus text format)."""
    from prometheus_fastapi_instrumentator import Instrumentator

    Instrumentator(
        should_group_status_codes=True,
        should_ignore_untemplated=True,
        excluded_handlers=[
            "/metrics",
            "/docs",
            "/redoc",
            "/openapi.json",
            "/favicon.ico",
        ],
    ).instrument(app).expose(
        app,
        endpoint="/metrics",
        include_in_schema=True,
        tags=["health"],
    )

    @app.middleware("http")
    async def _refresh_gauges_on_scrape(request, call_next):
        if str(request.url.path).rstrip("/").endswith("/metrics"):
            refresh_dependency_gauges()
        return await call_next(request)

    logger.info("Prometheus metrics exposed at /metrics")


def setup_otel(app: "FastAPI") -> bool:
    """Optional OpenTelemetry (ADR 0011). No-op unless enabled + otel extra installed.

    Enable with OTEL_ENABLED=true and/or OTEL_EXPORTER_OTLP_ENDPOINT.
    Install: pip install -e '.[otel]'
    """
    import os

    endpoint = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    enabled_raw = (os.getenv("OTEL_ENABLED") or "").strip().lower()
    try:
        from app.core.config import settings as _settings

        settings_on = bool(getattr(_settings, "otel_enabled", False))
        service_default = str(getattr(_settings, "otel_service_name", None) or "recombyn-api")
    except Exception:
        settings_on = False
        service_default = "recombyn-api"
    enabled = (
        enabled_raw in ("1", "true", "yes", "on") or bool(endpoint) or settings_on
    )
    if not enabled:
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )
    except ImportError:
        logger.warning(
            "OTEL enabled but packages missing — pip install -e '.[otel]'"
        )
        return False

    service = os.getenv("OTEL_SERVICE_NAME") or service_default
    resource = Resource.create({"service.name": service})
    provider = TracerProvider(resource=resource)
    if endpoint:
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    else:
        # Local DX: spans to stdout when enabled without a collector.
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, excluded_urls="metrics,health,docs,redoc,openapi.json")
    try:
        from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

        HTTPXClientInstrumentor().instrument()
    except Exception:
        logger.debug("httpx OTel instrument skipped", exc_info=True)
    logger.info("OpenTelemetry tracing enabled service=%s endpoint=%s", service, endpoint or "console")
    return True
