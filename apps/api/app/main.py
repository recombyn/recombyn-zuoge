"""Recombyn API entry — FastAPI app (uvicorn app.main:app)."""

from __future__ import annotations

import json
import logging
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute

from app.api.main import api_router
from app.core.config import settings
from app.services.db import init_schema


def custom_generate_unique_id(route: APIRoute) -> str:
    tag = route.tags[0] if route.tags else "api"
    return f"{tag}-{route.name}"


class _JsonLogFormatter(logging.Formatter):
    """Optional JSON stdout lines (LOG_JSON / settings.log_json) — ADR 0007."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        for key in ("trace_id", "job_id", "event", "user_id"):
            val = getattr(record, key, None)
            if val is not None and str(val):
                payload[key] = val
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _configure_logging() -> None:
    root = logging.getLogger()
    handler = logging.StreamHandler(sys.stdout)
    if bool(getattr(settings, "log_json", False)):
        handler.setFormatter(_JsonLogFormatter())
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
        )
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


_configure_logging()
try:
    from app.services.security import install_log_redaction

    install_log_redaction()
except Exception:
    pass
for _name in (
    "services.design.runtime.orchestrator",
    "services.design.runtime.graph.build",
    "services.design.runtime.llm_step",
    "design.run_api",
    "design.llm_step",
):
    logging.getLogger(_name).setLevel(logging.INFO)

logger = logging.getLogger(__name__)

_DEV_COLLAB_SECRET = "dev-collab-token-secret-change-me"
_DEFAULT_MYSQL_URL = "mysql://recombyn:recombyn@mysql:3306/recombyn"


def _warn_insecure_defaults() -> None:
    """Log loud warnings when local defaults would be unsafe on a public host."""
    try:
        from app.services.auth.admin import SUPER_ADMIN_BOOTSTRAP_PASSWORD

        if SUPER_ADMIN_BOOTSTRAP_PASSWORD == "Admin@2026":
            logger.warning(
                "SUPER_ADMIN_BOOTSTRAP_PASSWORD is still the default — "
                "set SUPER_ADMIN_BOOTSTRAP_PASSWORD before any public deploy"
            )
    except Exception:
        pass

    import os

    collab_secret = (os.getenv("COLLAB_TOKEN_SECRET") or "").strip() or _DEV_COLLAB_SECRET
    if collab_secret == _DEV_COLLAB_SECRET:
        logger.warning(
            "COLLAB_TOKEN_SECRET is still the compose/dev default — "
            "set a long random secret before any public deploy (must match collab)"
        )

    db_url = (os.getenv("DATABASE_URL") or "").strip()
    if db_url == _DEFAULT_MYSQL_URL or "recombyn:recombyn@" in db_url:
        logger.warning(
            "DATABASE_URL still uses the default MySQL password (recombyn) — "
            "change MYSQL_PASSWORD / DATABASE_URL before any public deploy"
        )

    card_salt = (getattr(settings, "card_key_salt", None) or "").strip()
    if not card_salt or card_salt.startswith("replace-with-") or card_salt.lower() in {
        "change-me",
        "change-me-to-a-long-random-string",
        "secret",
        "salt",
        "card_key_salt",
        "recombyn",
    }:
        logger.warning(
            "CARD_KEY_SALT is empty or still a placeholder — "
            "set a strong random salt before issuing card keys publicly"
        )

    byok = (os.getenv("BYOK_AES_KEY") or "").strip()
    if not byok:
        logger.warning(
            "BYOK_AES_KEY is empty — user LLM vault keys derive from CARD_KEY_SALT (dev only); "
            "set a dedicated 32+ char key for public deploy"
        )

    ws = (os.getenv("COLLAB_PUBLIC_WS_URL") or "").strip().lower()
    if ws.startswith("ws://") and "localhost" not in ws and "127.0.0.1" not in ws:
        logger.warning(
            "COLLAB_PUBLIC_WS_URL is plain ws:// on a non-local host — "
            "public HTTPS deploys need wss:// (see deploy/caddy/Caddyfile.example)"
        )


def _startup() -> None:
    _warn_insecure_defaults()
    init_schema()
    try:
        from app.core.db import init_db

        init_db()
    except Exception:
        logger.exception("SQLModel init_db failed")
    try:
        from app.services.security import ensure_byok_table

        ensure_byok_table()
    except Exception:
        logger.exception("byok table bootstrap failed")
    try:
        from app.services.db.backup import start_db_backup_scheduler

        start_db_backup_scheduler()
        logger.info("db backup scheduler started")
    except Exception:
        logger.exception("db backup scheduler failed to start")
    try:
        from app.services.seed import run_seeds

        counts = run_seeds()
        logger.info("seed complete: %s", counts)
    except Exception:
        logger.exception("seed failed")
    try:
        from app.services.design.readpath.catalog import ensure_design_catalog

        ensure_design_catalog()
        logger.info("design catalog ready")
        try:
            from app.services.design.prompts.skill_store import start_skills_hot_reload

            if start_skills_hot_reload():
                logger.info("design skills hot reload started")
        except Exception:
            logger.exception("design skills hot reload failed to start")
    except Exception:
        logger.exception("design catalog bootstrap failed")
    try:
        from app.services.llm.agent import configure_langfuse

        lf = configure_langfuse()
        logger.info(
            "langfuse: enabled=%s host=%s",
            lf.get("enabled"),
            lf.get("host"),
        )
    except Exception:
        logger.exception("langfuse configure failed")
    try:
        from app.services.design.admin.admin_store import start_usage_optimize_scheduler

        start_usage_optimize_scheduler()
        logger.info("usage optimize scheduler started")
    except Exception:
        logger.exception("usage optimize scheduler failed to start")
    try:
        from app.services.design.runtime.graph.build import (
            start_design_checkpoint_ttl_scheduler,
        )

        start_design_checkpoint_ttl_scheduler()
        logger.info("design checkpoint TTL scheduler started")
    except Exception:
        logger.exception("design checkpoint TTL scheduler failed to start")
    try:
        import threading

        def _cold_pass() -> None:
            try:
                from app.services.design.admin.cold_archive import run_cold_archive

                result = run_cold_archive(retention_days=30, batch=40)
                logger.info("cold archive startup pass: %s", result)
            except Exception:
                logger.exception("cold archive startup pass failed")

        threading.Thread(target=_cold_pass, name="cold-archive", daemon=True).start()
    except Exception:
        logger.exception("cold archive thread failed to start")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    _startup()
    yield


app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Canvas Scene API + Design Agent runtime",
    version="0.1.0",
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)


@app.middleware("http")
async def correlate_trace_middleware(request: Request, call_next):
    """Propagate X-Trace-Id / X-Request-Id; prefer active OTel span when present (ADR 0007 / 0011)."""
    from app.services.job_store import normalize_trace_id

    incoming = request.headers.get("x-trace-id") or request.headers.get("x-request-id")
    trace_id = normalize_trace_id(incoming)
    try:
        from opentelemetry import trace

        span = trace.get_current_span()
        ctx = span.get_span_context() if span is not None else None
        if ctx is not None and getattr(ctx, "is_valid", False):
            trace_id = format(int(ctx.trace_id), "032x")
    except Exception:
        pass
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["X-Trace-Id"] = trace_id
    return response


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path or ""
    if (
        path in ("/", "/docs", "/openapi.json", "/redoc", "/metrics")
        or path.startswith(f"{settings.API_V1_STR}/health")
    ):
        return await call_next(request)
    try:
        from app.services.security import _client_ip, check_rate_limit

        auth = request.headers.get("authorization") or ""
        identity = (
            auth[7:23]
            if auth.lower().startswith("bearer ") and len(auth) > 10
            else ""
        )
        if not identity:
            identity = _client_ip(
                {k: v for k, v in request.headers.items()},
                request.client.host if request.client else None,
            )
        ok, limit = check_rate_limit(path=path, identity=identity)
        if not ok:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests", "limit": limit},
                headers={"Retry-After": "60"},
            )
    except Exception:
        logger.debug("rate limit check failed", exc_info=True)
    return await call_next(request)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Browser-facing hardening when API is hit directly (not only via nginx)."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    # API returns JSON — lock down document embedding / script execution.
    response.headers.setdefault(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    )
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

try:
    from app.core.metrics import setup_metrics, setup_otel

    setup_metrics(app)
    setup_otel(app)
except Exception:
    logger.exception("Prometheus / OTel setup failed")


@app.get("/")
def root():
    return {"service": "recombyn-api", "docs": "/docs"}
