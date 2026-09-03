"""Doubao Seedream 5.0 Pro — layer_decomposition via Ark images/generations.

Docs: https://docs.volcengine.com/docs/82379/2582774#layer_decomposition
"""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from PIL import Image

from app.core.config import settings
from app.services.vision.providers.base import ProgressCb

logger = logging.getLogger(__name__)

_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(?:;base64)?,(.+)$", re.DOTALL)
_DEFAULT_MODEL = "doubao-seedream-5-0-pro-260628"
_ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3"
_SEEDREAM_REQUIRED_MSG = (
    "此功能需要配置豆包方舟（设置 DOUBAO_API_KEY，"
    "见 https://console.volcengine.com/ark）"
)
_TIMEOUT_SEC = 180.0


def seedream_enabled() -> bool:
    from app.services.llm import _api_key_for

    return bool(_api_key_for("doubao"))


def seedream_supports() -> list[str]:
    if not seedream_enabled():
        return []
    return ["editElements"]


def layer_model_id() -> str:
    mid = str(settings.vision_seedream_layer_model or _DEFAULT_MODEL).strip()
    return mid or _DEFAULT_MODEL


def _require_enabled() -> None:
    if not seedream_enabled():
        raise RuntimeError(_SEEDREAM_REQUIRED_MSG)


def _is_http_url(ref: str) -> bool:
    try:
        parsed = urlparse(ref)
    except Exception:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


async def _ensure_image_ref(image: str, *, user_id: str | None) -> str:
    """Ark accepts public URL or data URL; rehost private refs when needed."""
    ref = (image or "").strip()
    if not ref:
        raise ValueError("image is required")
    if _is_http_url(ref) or ref.startswith("data:"):
        return ref
    raise ValueError("image must be a data URL or http(s) URL")


async def _download(url_or_data: str) -> bytes:
    ref = (url_or_data or "").strip()
    if not ref:
        raise RuntimeError("empty Seedream layer URL")
    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise RuntimeError("invalid data URL from Seedream")
        return base64.b64decode(match.group(2))
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(ref)
        resp.raise_for_status()
        return resp.content


def _parse_size_wh(raw: Any) -> tuple[int, int]:
    s = str(raw or "").strip().lower()
    if "x" in s:
        parts = s.split("x", 1)
        try:
            w, h = int(parts[0]), int(parts[1])
            if w > 0 and h > 0:
                return w, h
        except ValueError:
            pass
    return 0, 0


def _bbox_xywh(item: dict[str, Any]) -> tuple[float, float, float, float] | None:
    box = item.get("bounding_box")
    if not isinstance(box, dict):
        return None
    absolute = box.get("absolute")
    if not isinstance(absolute, (list, tuple)) or len(absolute) < 4:
        return None
    try:
        left, top, right, bottom = (
            float(absolute[0]),
            float(absolute[1]),
            float(absolute[2]),
            float(absolute[3]),
        )
    except (TypeError, ValueError):
        return None
    w = max(0.0, right - left)
    h = max(0.0, bottom - top)
    if w <= 0 or h <= 0:
        return None
    return left, top, w, h


def _item_url(item: dict[str, Any]) -> str:
    url = str(item.get("url") or "").strip()
    if url:
        return url
    b64 = str(item.get("b64_json") or "").strip()
    if b64:
        return f"data:image/png;base64,{b64}"
    return ""


def map_seedream_data_to_layers(
    data_items: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Normalize Ark ``data[]`` into ordered layer dicts (url + geometry)."""
    rows: list[dict[str, Any]] = []
    for i, raw in enumerate(data_items):
        if not isinstance(raw, dict):
            continue
        try:
            z = int(raw.get("z_index") if raw.get("z_index") is not None else i)
        except (TypeError, ValueError):
            z = i
        url = _item_url(raw)
        if not url:
            continue
        name = str(raw.get("name") or "").strip() or (
            "Background" if z == 0 else f"Layer {z}"
        )
        rows.append(
            {
                "z_index": z,
                "url": url,
                "name": name,
                "description": str(raw.get("description") or "").strip(),
                "size": raw.get("size"),
                "bounding_box": raw.get("bounding_box"),
            }
        )
    rows.sort(key=lambda r: int(r["z_index"]))
    return rows


async def run_layered(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    on_progress: ProgressCb = None,
) -> dict[str, Any]:
    """
    Call Seedream ``layer_decomposition=true``.

    Returns ``{ layers: [{bytes,x,y,width,height,name,z_index}], canvas_width, canvas_height, model }``.
    """
    _require_enabled()
    from app.services.llm import _api_key_for

    m = meta or {}
    image_ref = await _ensure_image_ref(image, user_id=user_id)
    size = str(m.get("size") or m.get("resolution") or "auto").strip() or "auto"
    if size.upper() in ("1K", "1.5K", "2K"):
        size = size.upper() if size.upper() != "1.5K" else "1.5K"
    prompt = str(m.get("prompt") or "").strip()
    model = layer_model_id()

    body: dict[str, Any] = {
        "model": model,
        "image": image_ref,
        "size": size,
        "layer_decomposition": True,
        "watermark": False,
        "response_format": "url",
        "output_format": "png",
    }
    if prompt:
        body["prompt"] = prompt

    if on_progress:
        on_progress(10, "seedream:layer_decomposition")

    api_key = _api_key_for("doubao")
    timeout = float(settings.vision_seedream_timeout_sec or _TIMEOUT_SEC)

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=20.0)) as client:
        resp = await client.post(
            f"{_ARK_BASE}/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
        if resp.status_code >= 400:
            detail = (resp.text or "")[:500]
            raise RuntimeError(
                f"Seedream layer_decomposition failed ({resp.status_code}): {detail}"
            )
        payload = resp.json()

    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, list) or not data:
        raise RuntimeError("Seedream layer_decomposition returned no data")

    mapped = map_seedream_data_to_layers(
        [x for x in data if isinstance(x, dict)]
    )
    if not mapped:
        raise RuntimeError("Seedream layer_decomposition returned empty layers")

    if on_progress:
        on_progress(50, "seedream:download")

    canvas_w, canvas_h = 0, 0
    layers_out: list[dict[str, Any]] = []
    for row in mapped:
        raw_bytes = await _download(str(row["url"]))
        z = int(row["z_index"])
        xywh = _bbox_xywh(row)
        size_w, size_h = _parse_size_wh(row.get("size"))
        if z == 0:
            if size_w > 0 and size_h > 0:
                canvas_w, canvas_h = size_w, size_h
            else:
                with Image.open(io.BytesIO(raw_bytes)) as img:
                    canvas_w, canvas_h = int(img.width), int(img.height)
            x, y, w, h = 0.0, 0.0, float(canvas_w), float(canvas_h)
        elif xywh:
            x, y, w, h = xywh
        else:
            with Image.open(io.BytesIO(raw_bytes)) as img:
                nw, nh = int(img.width), int(img.height)
            x, y, w, h = 0.0, 0.0, float(nw), float(nh)
        layers_out.append(
            {
                "bytes": raw_bytes,
                "x": x,
                "y": y,
                "width": w,
                "height": h,
                "name": str(row["name"]),
                "z_index": z,
                "description": str(row.get("description") or ""),
            }
        )

    if canvas_w <= 0 or canvas_h <= 0:
        first = layers_out[0]
        canvas_w = int(first["width"])
        canvas_h = int(first["height"])

    if on_progress:
        on_progress(90, "seedream:done")

    return {
        "layers": layers_out,
        "canvas_width": canvas_w,
        "canvas_height": canvas_h,
        "model": model,
        "engine": "seedream:layer_decomposition",
    }
