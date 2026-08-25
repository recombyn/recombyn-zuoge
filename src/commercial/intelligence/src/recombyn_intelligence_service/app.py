"""HTTP service: POST /v1/{method} for the product Runtime remote client.

Accepts canonical method names from ``recombyn_protocol``.
Empty ``{}`` for skip / unknown → host Runtime uses its local fallback.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from recombyn_protocol.intelligence import intelligence_wire_methods

from recombyn_intelligence_service.providers import handle_method
from recombyn_intelligence_service.mockup import mount_mockup_routes
from recombyn_intelligence_service.vision import mount_vision_routes


def _expected_key() -> str:
    return str(os.environ.get("INTELLIGENCE_SERVICE_API_KEY") or "").strip()


def _production_guard() -> None:
    """Fail fast when production flag is set without API key."""
    prod = str(os.environ.get("INTELLIGENCE_PRODUCTION") or "").strip().lower()
    if prod not in {"1", "true", "yes", "on"}:
        return
    if not _expected_key():
        raise RuntimeError(
            "INTELLIGENCE_PRODUCTION=1 requires INTELLIGENCE_SERVICE_API_KEY to be set"
        )


_production_guard()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    try:
        from recombyn_intelligence_service.vision.warmup import schedule_warmup

        schedule_warmup()
    except Exception:
        pass
    yield


app = FastAPI(title="recombyn-intelligence", version="0.1.0", lifespan=_lifespan)

_METHODS = intelligence_wire_methods()


def _check_auth(authorization: str | None) -> None:
    expected = _expected_key()
    if not expected:
        return
    token = ""
    raw = str(authorization or "").strip()
    if raw.lower().startswith("bearer "):
        token = raw[7:].strip()
    if token != expected:
        raise HTTPException(status_code=401, detail="unauthorized")


mount_vision_routes(app, auth_check=_check_auth)
mount_mockup_routes(app, auth_check=_check_auth)


@app.get("/health")
async def health() -> dict:
    from image_layer_pipeline.vision_capabilities import vision_model_status, vision_ready_for_production
    from mockup_pipeline.loader import list_templates
    from recombyn_intelligence_service.mockup.config import settings as mockup_settings
    from image_layer_pipeline.stages.inpainting.flux import flux_available
    from recombyn_intelligence_service.vision.infra.job_executor import queue_stats

    models = vision_model_status()
    blocker = vision_ready_for_production()
    return {
        "status": "ok" if not blocker else "degraded",
        "service": "recombyn-intelligence",
        "production_blocker": blocker or None,
        "vision": {
            "enabled": True,
            "queue": queue_stats(),
            "flux": flux_available(),
            "models": models,
        },
        "mockup": {
            "enabled": True,
            "templates": len(list_templates(mockup_settings.templates_dir)),
        },
    }


@app.get("/billing/plans")
async def billing_get_plans(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Public plan list prices + credit grants (no margin)."""
    _check_auth(authorization)
    from recombyn_intelligence_service.billing import get_public_plan_catalog

    return get_public_plan_catalog()


@app.get("/billing/commercial")
async def billing_get_commercial(
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Admin-only commercial config (includes private margin_factor)."""
    _check_auth(authorization)
    from recombyn_intelligence_service.billing import get_commercial_config

    return get_commercial_config()


@app.put("/billing/commercial")
async def billing_put_commercial(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_auth(authorization)
    from recombyn_intelligence_service.billing import put_commercial_config

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    try:
        return put_commercial_config(body)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@app.post("/billing/quote")
async def billing_quote(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Runtime-safe credit quote — no margin / internal cost fields."""
    _check_auth(authorization)
    from recombyn_intelligence_service.billing import quote_task_credits

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return quote_task_credits(body)


@app.post("/billing/cost")
async def billing_cost(
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Admin/debug: internal cost breakdown (never expose to end users)."""
    _check_auth(authorization)
    from recombyn_intelligence_service.billing import estimate_internal_cost_micros

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}
    return estimate_internal_cost_micros(
        meters=body.get("meters") if isinstance(body.get("meters"), dict) else None,
        usage=body.get("usage") if isinstance(body.get("usage"), dict) else None,
        tokens_in=int(body.get("tokens_in") or 0),
        tokens_out=int(body.get("tokens_out") or 0),
        image_count=int(body.get("image_count") or 0),
        agent_steps=int(body.get("agent_steps") or 0),
        rates=body.get("rates") if isinstance(body.get("rates"), list) else None,
        pricing_rates=(
            body.get("pricing_rates")
            if isinstance(body.get("pricing_rates"), list)
            else None
        ),
    )


@app.post("/v1/{method}")
async def intelligence_method(
    method: str,
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _check_auth(authorization)
    name = str(method or "").strip()
    if name not in _METHODS:
        raise HTTPException(status_code=404, detail="unknown method")

    try:
        body = await request.json()
    except Exception:
        body = {}
    if not isinstance(body, dict):
        body = {}

    return handle_method(name, body)
