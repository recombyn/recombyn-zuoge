"""Video generation (submit + poll)."""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.services.llm import (
    _api_key_for,
    build_async_openai_client,
    list_video_models,
    openai_json_get,
    openai_json_post,
)

logger = logging.getLogger(__name__)

_POLL_INTERVAL_S = 2.0
_POLL_MAX_S = 600.0


def _admin_video_default() -> str:
    try:
        from app.services.design.readpath.catalog import get_global_rules

        return (get_global_rules().get("assets.video_default_model") or "").strip()
    except Exception:
        return ""


def resolve_video_model(model: str | None = None) -> str:
    """Resolve video catalog id from arg → Admin rule → catalog (no hardcoded id)."""
    mid = (model or _admin_video_default() or "").strip()
    known = {m["id"]: m for m in list_video_models()}
    if mid in known:
        return mid
    if mid:
        return mid
    if known:
        preferred = next(
            (m["id"] for m in known.values() if "fast" in str(m.get("id") or "").lower()),
            None,
        )
        return preferred or next(iter(known))
    return ""


def _api_model_id(catalog_id: str) -> str:
    for m in list_video_models():
        if m["id"] == catalog_id:
            return str(m.get("apiModel") or m["id"])
    return catalog_id or ""


def _pick_video_url(payload: dict[str, Any]) -> str:
    urls = payload.get("unsigned_urls")
    if isinstance(urls, list):
        for u in urls:
            s = str(u or "").strip()
            if s:
                return s
    for key in ("url", "video_url", "signed_url"):
        s = str(payload.get(key) or "").strip()
        if s:
            return s
    return ""


async def _poll_video_job(
    client: Any,
    *,
    polling_url: str,
    signal_deadline: float,
) -> dict[str, Any]:
    """Poll OpenRouter job until completed / failed / timeout."""
    path = (polling_url or "").strip()
    if path.startswith("http://") or path.startswith("https://"):
        # Absolute polling URL — use httpx via raw client base.
        from urllib.parse import urlparse

        parsed = urlparse(path)
        rel = parsed.path or path
        if parsed.query:
            rel = f"{rel}?{parsed.query}"
        path = rel
    elif not path.startswith("/"):
        path = f"/videos/{path}"

    elapsed = 0.0
    while elapsed < signal_deadline:
        data = await openai_json_get(client, path)
        if not isinstance(data, dict):
            raise RuntimeError("OpenRouter video poll returned non-JSON")

        status = str(data.get("status") or "").lower()
        if status in ("completed", "complete", "succeeded", "success"):
            return data
        if status in ("failed", "error", "cancelled", "canceled"):
            err = data.get("error") or data.get("message") or status
            raise RuntimeError(f"video generation failed: {err}")

        await asyncio.sleep(_POLL_INTERVAL_S)
        elapsed += _POLL_INTERVAL_S

    raise RuntimeError("video generation timed out")


async def generate_video(
    *,
    prompt: str,
    model: str | None = None,
    aspect_ratio: str | None = None,
    resolution: str | None = None,
    duration: int | None = None,
    images: list[str] | None = None,
) -> dict[str, Any]:
    """
    Text-to-video (optional first-frame image refs) via OpenRouter Videos API.

    Returns ``{ videos: [url], model, text? }``.
    """
    text = (prompt or "").strip()
    if not text:
        raise ValueError("empty prompt")

    catalog_id = resolve_video_model(model)
    api_model = _api_model_id(catalog_id)
    api_key = _api_key_for("openrouter")
    if not api_key:
        raise RuntimeError("No LLM API key configured for OpenRouter video")

    body: dict[str, Any] = {
        "model": api_model,
        "prompt": text,
    }
    ar = (aspect_ratio or "").strip()
    if ar and ar != "smart":
        body["aspect_ratio"] = ar
    res = (resolution or "").strip()
    if res:
        body["resolution"] = res
    if duration is not None:
        try:
            body["duration"] = int(duration)
        except (TypeError, ValueError):
            pass

    refs = [str(u).strip() for u in (images or []) if str(u or "").strip()]
    if refs:
        # First image → first frame; extra images as style references when present.
        body["frame_images"] = [
            {
                "type": "image_url",
                "frame_type": "first_frame",
                "image_url": {"url": refs[0]},
            }
        ]
        if len(refs) > 1:
            body["input_references"] = [
                {"type": "image_url", "image_url": {"url": u}} for u in refs[1:]
            ]

    client, _endpoint = build_async_openai_client(
        provider="openrouter",
        api_model=api_model,
        timeout=max(180.0, _POLL_MAX_S + 30.0),
    )
    try:
        submitted = await openai_json_post(client, "/videos", body)
    except Exception as err:  # noqa: BLE001
        raise RuntimeError(f"OpenRouter video submit failed: {err}") from err

    status = str(submitted.get("status") or "").lower()
    url = _pick_video_url(submitted)
    if url and status in ("completed", "complete", "succeeded", "success", ""):
        return {"videos": [url], "model": catalog_id, "text": None}

    polling = str(submitted.get("polling_url") or "").strip()
    job_id = str(submitted.get("id") or "").strip()
    if not polling and job_id:
        polling = f"/videos/{job_id}"
    if not polling:
        raise RuntimeError("OpenRouter video response missing polling_url")

    done = await _poll_video_job(client, polling_url=polling, signal_deadline=_POLL_MAX_S)
    url = _pick_video_url(done)
    if not url:
        raise RuntimeError("video generation completed without url")
    return {"videos": [url], "model": catalog_id, "text": None}
