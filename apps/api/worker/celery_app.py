from celery import Celery
from celery.signals import worker_process_init

from app.core.config import settings

celery = Celery(
    "resume_scene",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=["worker.tasks"],
)

celery.conf.update(
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    worker_prefetch_multiplier=1,
    beat_schedule={
        "design-agent-requeue": {
            "task": "worker.tasks.requeue_stale_design_agent_jobs",
            "schedule": 60.0,
        },
        "design-agent-lease-recovery": {
            "task": "worker.tasks.recover_expired_design_agent_leases",
            "schedule": 60.0,
        },
        "design-agent-outbox-prune": {
            "task": "worker.tasks.prune_design_agent_outboxes",
            "schedule": 60 * 60 * 24,
        },
        "db-backup-daily": {
            "task": "worker.tasks.run_db_backup_job",
            "schedule": 60 * 60 * 24,  # seconds; override via Celery beat if needed
            "args": ("beat",),
        },
    },
)


@worker_process_init.connect
def _warm_worker_schema(**_kwargs) -> None:
    """Run Alembic + catalog seed once at worker boot — not mid image job."""
    import logging

    try:
        from app.services.db import init_schema

        init_schema()
    except Exception:
        logging.getLogger(__name__).exception("worker init_schema failed")


@worker_process_init.connect
def _otel_worker_init(**_kwargs) -> None:
    """Optional OTel in Celery child processes (ADR 0011)."""
    import logging
    import os

    endpoint = (os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT") or "").strip()
    enabled_raw = (os.getenv("OTEL_ENABLED") or "").strip().lower()
    enabled = (
        enabled_raw in ("1", "true", "yes", "on")
        or bool(endpoint)
        or bool(getattr(settings, "otel_enabled", False))
    )
    if not enabled:
        return
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.instrumentation.celery import CeleryInstrumentor
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            BatchSpanProcessor,
            ConsoleSpanExporter,
        )
    except ImportError:
        logging.getLogger(__name__).warning(
            "Celery OTel enabled but packages missing — pip install -e '.[otel]'"
        )
        return

    service = (
        os.getenv("OTEL_SERVICE_NAME")
        or f"{getattr(settings, 'otel_service_name', 'recombyn-api')}-worker"
    )
    if not service.endswith("-worker"):
        service = f"{service}-worker"
    resource = Resource.create({"service.name": service})
    provider = TracerProvider(resource=resource)
    if endpoint:
        provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    else:
        provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    CeleryInstrumentor().instrument()
    logging.getLogger(__name__).info(
        "OpenTelemetry Celery tracing enabled service=%s", service
    )
