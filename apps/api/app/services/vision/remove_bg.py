"""Background removal (抠图) — Recombyn Intelligence industrial matting only."""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any

from PIL import Image

from app.services.vision.ilp_client import ilp_enabled, segment_foreground_via_ilp
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

_ILP_REQUIRED_MSG = (
    "工业抠图需要接入 Recombyn Intelligence 闭源服务（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)
_DATA_URL_RE = re.compile(r"^data:[^;,]+(?:;base64)?,(.+)$", re.DOTALL)


def _png_data_url_from_pil(img: Image.Image) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _decode_optional_mask(raw: object) -> bytes | None:
    s = str(raw or "").strip()
    if not s:
        return None
    if not s.startswith("data:"):
        raise ValueError("matting mask must be a data URL")
    match = _DATA_URL_RE.match(s)
    if not match:
        raise ValueError("invalid matting mask data URL")
    return base64.b64decode(match.group(1))


async def remove_background(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Cut out the main subject via intelligence BiRefNet matting.

    Keeps the original canvas size (transparent outside the subject) — no bbox trim.
    Forwards optional FE brush hints (``includeMask`` / ``excludeMask``).

    Returns ``{ image, kind, engine, model, mode, width, height }``.
    """
    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    m = meta or {}
    model_name = str(m.get("segmentationModel") or "birefnet-general").strip() or "birefnet-general"
    # Prefer meta decontaminate when set; default stronger edge cleanup for product photos.
    try:
        decontaminate = float(m.get("decontaminate")) if m.get("decontaminate") is not None else 0.85
    except (TypeError, ValueError):
        decontaminate = 0.85
    decontaminate = max(0.0, min(1.0, decontaminate))

    include_mask = _decode_optional_mask(m.get("includeMask"))
    exclude_mask = _decode_optional_mask(m.get("excludeMask"))

    png_bytes, _ctype = await segment_foreground_via_ilp(
        image,
        model=model_name,
        decontaminate=decontaminate,
        include_mask=include_mask,
        exclude_mask=exclude_mask,
    )
    rgba = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    # Prefer storage URL so FE skips a second giant data-URL upload.
    image_out = rehost_image_bytes(user_id, png_bytes, filename="removeBg.png")
    if not image_out:
        image_out = _png_data_url_from_pil(rgba)
    return {
        "image": image_out,
        "kind": "removeBg",
        "engine": "ilp:birefnet",
        "model": model_name,
        "mode": "ilp",
        "width": int(rgba.width),
        "height": int(rgba.height),
    }
