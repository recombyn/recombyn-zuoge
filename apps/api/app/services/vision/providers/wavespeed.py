"""WaveSpeedAI HTTP client — submit prediction + poll result.

Docs:
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/qwen-image/edit-multiple-angles
- https://wavespeed.ai/docs/docs-api/wavespeed-ai/qwen-image-layered
"""

from __future__ import annotations

import asyncio
import base64
import io
import re
import time
from typing import Any

import httpx
from PIL import Image

from app.core.config import settings
from app.services.vision.providers.base import ProgressCb
from app.services.vision.rehost import (
    bytes_to_data_url,
    ipv4_loopback_url,
    is_http_url,
    is_public_http_url,
    rehost_image_bytes,
)

_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(?:;base64)?,(.+)$", re.DOTALL)
_TERMINAL_FAIL = frozenset({"failed", "cancelled", "timeout", "deleted"})
_MULTI_ANGLE_PATH = "wavespeed-ai/qwen-image/edit-multiple-angles"
_LAYERED_PATH = "wavespeed-ai/qwen-image/layered"
_POLL_SEC = 2.0
_WAVESPEED_REQUIRED_MSG = (
    "此功能需要配置 WaveSpeedAI（设置 WAVESPEED_API_KEY，"
    "见 https://wavespeed.ai/）"
)


def wavespeed_enabled() -> bool:
    return bool(str(settings.wavespeed_api_key or "").strip())


def wavespeed_supports() -> list[str]:
    if not wavespeed_enabled():
        return []
    return ["multiAngle", "editElements"]


def _require_enabled() -> None:
    if not wavespeed_enabled():
        raise RuntimeError(_WAVESPEED_REQUIRED_MSG)


def _base_url() -> str:
    return str(settings.wavespeed_base_url or "https://api.wavespeed.ai").rstrip("/")


def _timeout() -> float:
    return float(settings.wavespeed_timeout_sec or 180.0)


def _auth_headers() -> dict[str, str]:
    key = str(settings.wavespeed_api_key or "").strip()
    return {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }


def _unwrap_data(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    data = payload.get("data")
    if isinstance(data, dict):
        return data
    return payload


def _outputs_list(task: dict[str, Any]) -> list[str] | None:
    outputs = task.get("outputs")
    if not isinstance(outputs, list) or not outputs:
        return None
    return [str(x) for x in outputs if str(x).strip()]


async def _load_image_bytes(image_ref: str) -> tuple[bytes, str]:
    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")
    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise ValueError("invalid data URL")
        return base64.b64decode(match.group(2)), "image/png"
    if not is_http_url(ref):
        raise ValueError("image must be a data URL or http(s) URL")
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(ipv4_loopback_url(ref))
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/png"
        return resp.content, ctype


async def ensure_public_image_url(
    image: str,
    *,
    user_id: str | None,
    filename: str = "wavespeed-input.png",
) -> str:
    """WaveSpeed fetches remote URLs; inline private / loopback refs as data URLs."""
    ref = (image or "").strip()
    if not ref:
        raise ValueError("image is required")
    if is_http_url(ref) and is_public_http_url(ref):
        return ref
    raw, ctype = await _load_image_bytes(ref)
    uid = str(user_id or "").strip()
    if uid:
        ext = "png" if "png" in ctype else "jpg"
        name = filename if filename.endswith(ext) else f"wavespeed-input.{ext}"
        hosted = rehost_image_bytes(
            uid, raw, filename=name, content_type=ctype or "image/png"
        )
        if is_public_http_url(hosted):
            return hosted
    return bytes_to_data_url(raw, content_type=ctype)


async def _download_output(url_or_b64: str) -> bytes:
    ref = (url_or_b64 or "").strip()
    if not ref:
        raise RuntimeError("empty WaveSpeed output")
    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise RuntimeError("invalid WaveSpeed data URL output")
        return base64.b64decode(match.group(2))
    # Naked base64 (enable_base64_output)
    if not is_http_url(ref) and len(ref) > 64 and re.fullmatch(r"[A-Za-z0-9+/=\s]+", ref):
        try:
            return base64.b64decode(ref)
        except Exception:
            pass
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(ref)
        resp.raise_for_status()
        return resp.content


async def submit_and_wait(
    model_path: str,
    body: dict[str, Any],
    *,
    on_progress: ProgressCb = None,
) -> list[str]:
    """POST model endpoint, poll ``/api/v3/predictions/{id}/result``, return outputs."""
    _require_enabled()
    path = (model_path or "").strip().lstrip("/")
    if not path:
        raise ValueError("model_path is required")
    submit_url = f"{_base_url()}/api/v3/{path}"
    timeout = _timeout()
    deadline = time.monotonic() + timeout
    headers = _auth_headers()

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=20.0)) as client:
        if on_progress:
            on_progress(5, "wavespeed:submit")
        submit_resp = await client.post(submit_url, headers=headers, json=body)
        if submit_resp.status_code >= 400:
            detail = (submit_resp.text or "")[:400]
            raise RuntimeError(f"WaveSpeed submit failed ({submit_resp.status_code}): {detail}")
        task = _unwrap_data(submit_resp.json())
        prediction_id = str(task.get("id") or "").strip()
        if not prediction_id:
            sync_out = _outputs_list(task)
            if sync_out:
                return sync_out
            raise RuntimeError("WaveSpeed submit response missing prediction id")

        if str(task.get("status") or "").strip().lower() == "completed":
            done = _outputs_list(task)
            if done:
                return done

        result_url = f"{_base_url()}/api/v3/predictions/{prediction_id}/result"
        poll_n = 0
        while True:
            if time.monotonic() > deadline:
                raise RuntimeError(f"WaveSpeed prediction timed out after {timeout:.0f}s")
            await asyncio.sleep(_POLL_SEC)
            poll_n += 1
            if on_progress:
                on_progress(min(90, 10 + poll_n * 5), "wavespeed:poll")
            poll_resp = await client.get(result_url, headers=headers)
            if poll_resp.status_code >= 400:
                detail = (poll_resp.text or "")[:400]
                raise RuntimeError(f"WaveSpeed poll failed ({poll_resp.status_code}): {detail}")
            result = _unwrap_data(poll_resp.json())
            status = str(result.get("status") or "").strip().lower()
            if status == "completed":
                done = _outputs_list(result)
                if not done:
                    raise RuntimeError("WaveSpeed completed with empty outputs")
                return done
            if status in _TERMINAL_FAIL:
                err = str(result.get("error") or status)
                raise RuntimeError(f"WaveSpeed prediction {status}: {err}")


def horizontal_angle_from_rotate(rotate: Any) -> int:
    """FE rotate -90..90 → WaveSpeed azimuth 0..359."""
    try:
        deg = int(round(float(rotate)))
    except (TypeError, ValueError):
        deg = 0
    deg %= 360
    if deg < 0:
        deg += 360
    return deg


def vertical_angle_from_tilt(tilt: Any) -> int:
    """FE tilt -60..60 → WaveSpeed elevation clamp -30..60."""
    try:
        deg = int(round(float(tilt)))
    except (TypeError, ValueError):
        deg = 0
    return max(-30, min(60, deg))


def distance_from_zoom(zoom: Any) -> int:
    """FE zoom 0/50/100 (or cube scale index) → WaveSpeed distance 0|1|2."""
    try:
        z = float(zoom)
    except (TypeError, ValueError):
        return 1
    if z <= 25:
        return 0
    if z >= 75:
        return 2
    return 1


def num_layers_from_meta(meta: dict[str, Any] | None) -> int:
    m = meta or {}
    raw = m.get("num_layers", m.get("numLayers"))
    try:
        n = int(raw) if raw is not None else 4
    except (TypeError, ValueError):
        n = 4
    return max(2, min(8, n))


async def run_multi_angle(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    on_progress: ProgressCb = None,
) -> dict[str, Any]:
    """Call edit-multiple-angles; return raw image bytes + size."""
    m = meta or {}
    public = await ensure_public_image_url(
        image, user_id=user_id, filename="multi-angle-input.png"
    )
    body = {
        "images": [public],
        "horizontal_angle": horizontal_angle_from_rotate(m.get("rotate", 0)),
        "vertical_angle": vertical_angle_from_tilt(m.get("tilt", 0)),
        "distance": distance_from_zoom(m.get("zoom", 50)),
        "output_format": "png",
    }
    prompt = str(m.get("prompt") or "").strip()
    if prompt:
        body["prompt"] = prompt
    outputs = await submit_and_wait(_MULTI_ANGLE_PATH, body, on_progress=on_progress)
    raw = await _download_output(outputs[0])
    with Image.open(io.BytesIO(raw)) as img:
        width, height = int(img.width), int(img.height)
    return {
        "image_bytes": raw,
        "width": width,
        "height": height,
        "model": _MULTI_ANGLE_PATH,
    }


async def run_layered(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    on_progress: ProgressCb = None,
) -> dict[str, Any]:
    """Call qwen-image/layered; return list of RGBA layer bytes."""
    m = meta or {}
    public = await ensure_public_image_url(
        image, user_id=user_id, filename="layered-input.png"
    )
    num_layers = num_layers_from_meta(m)
    body: dict[str, Any] = {
        "image": public,
        "num_layers": num_layers,
    }
    prompt = str(m.get("prompt") or "").strip()
    if prompt:
        body["prompt"] = prompt
    outputs = await submit_and_wait(_LAYERED_PATH, body, on_progress=on_progress)
    layers_bytes: list[bytes] = []
    width = 0
    height = 0
    for item in outputs:
        raw = await _download_output(item)
        layers_bytes.append(raw)
        if width <= 0 or height <= 0:
            with Image.open(io.BytesIO(raw)) as img:
                width, height = int(img.width), int(img.height)
    if not layers_bytes:
        raise RuntimeError("WaveSpeed layered returned no layers")
    return {
        "layers_bytes": layers_bytes,
        "width": width,
        "height": height,
        "num_layers": num_layers,
        "model": _LAYERED_PATH,
    }
