"""Multi-angle camera rewrite via WaveSpeed qwen-image/edit-multiple-angles."""

from __future__ import annotations

import base64
import io
import logging
from collections.abc import Callable
from typing import Any

from PIL import Image

from app.services.vision.providers.registry import resolve_multi_angle_provider
from app.services.vision.providers.wavespeed import run_multi_angle
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

ProgressCb = Callable[[int, str], None] | None


async def multi_angle_image(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
    on_progress: ProgressCb = None,
) -> dict[str, Any]:
    """
    Regenerate subject from a new camera pose.

    Returns ``{ image, kind, engine, model, width, height }``.
    """
    resolve_multi_angle_provider()
    out = await run_multi_angle(
        image, meta=meta, user_id=user_id, on_progress=on_progress
    )
    raw = out["image_bytes"]
    width = int(out.get("width") or 0)
    height = int(out.get("height") or 0)
    if width <= 0 or height <= 0:
        with Image.open(io.BytesIO(raw)) as img:
            width, height = int(img.width), int(img.height)

    if user_id:
        image_out = rehost_image_bytes(
            user_id, raw, filename="multi-angle.png", content_type="image/png"
        )
    else:
        b64 = base64.b64encode(raw).decode("ascii")
        image_out = f"data:image/png;base64,{b64}"

    model = str(out.get("model") or "wavespeed-ai/qwen-image/edit-multiple-angles")
    return {
        "image": image_out,
        "kind": "multiAngle",
        "engine": "wavespeed:edit-multiple-angles",
        "model": model,
        "width": width,
        "height": height,
    }
