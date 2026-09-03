"""Product scene generation — Volcengine MediaKit generate-product-scene-image."""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import (
    generate_product_scene_image,
    mediakit_enabled,
)
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "电商万创需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)


def _encode_or_rehost(
    raw: bytes,
    *,
    fmt: str,
    user_id: str | None,
    index: int,
) -> str:
    if user_id:
        filename = f"product-scene-{index}.png" if fmt == "png" else f"product-scene-{index}.jpg"
        content_type = "image/png" if fmt == "png" else "image/jpeg"
        return rehost_image_bytes(
            user_id, raw, filename=filename, content_type=content_type
        )
    img = Image.open(io.BytesIO(raw))
    buf = io.BytesIO()
    if fmt == "png":
        img.convert("RGBA" if "A" in img.getbands() else "RGB").save(buf, format="PNG")
        ctype = "image/png"
    else:
        img.convert("RGB").save(buf, format="JPEG", quality=92)
        ctype = "image/jpeg"
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:{ctype};base64,{b64}"


async def product_scene(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Generate marketing product scenes via MediaKit.

    Meta (standard): ``standardScene``, optional ``batchCount`` / ``prompt``.
    Meta (professional): ``prompt`` + ``professionalReferenceImageUrl``.
    Meta (industry): optional ``prompt`` / scene / detail refs.

    Returns ``{ image, images, kind, engine, model, mode, width, height }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    out = await generate_product_scene_image(image, meta=meta)
    rows = out.get("images") or []
    if not rows:
        raise RuntimeError("MediaKit product scene returned no images")

    urls: list[str] = []
    width = 0
    height = 0
    for i, row in enumerate(rows):
        raw = row["image_bytes"]
        fmt = str(row.get("format") or "png").lower()
        urls.append(_encode_or_rehost(raw, fmt=fmt, user_id=user_id, index=i))
        if not width:
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
            if not width or not height:
                img = Image.open(io.BytesIO(raw))
                width, height = img.width, img.height

    version = str(out.get("tool_version") or "standard")
    return {
        "image": urls[0],
        "images": urls,
        "kind": "productScene",
        "engine": "mediakit:generate-product-scene-image",
        "model": f"mediakit:{version}",
        "mode": "mediakit",
        "width": width,
        "height": height,
        "standardScene": out.get("standard_scene"),
    }
