"""Smart eraser — intelligence alpha punch-out from brush hints."""

from __future__ import annotations

import base64
import io
import logging
from typing import Any

from PIL import Image

from app.services.vision.ilp_client import erase_alpha_via_ilp, ilp_enabled

logger = logging.getLogger(__name__)

_ILP_REQUIRED_MSG = (
    "智能橡皮需要接入 Recombyn Intelligence 闭源服务（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)


def _png_data_url_from_bytes(png_bytes: bytes) -> str:
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _decode_data_url_mask(raw: str) -> bytes:
    ref = (raw or "").strip()
    if not ref:
        raise ValueError("eraseMask is required")
    if ref.startswith("data:"):
        import re

        match = re.match(r"^data:[^;,]+(?:;base64)?,(.+)$", ref, re.DOTALL)
        if not match:
            raise ValueError("invalid eraseMask data URL")
        return base64.b64decode(match.group(1))
    raise ValueError("eraseMask must be a data URL")


async def smart_erase(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Erase painted regions (expanded to similar areas) via intelligence.

    Returns ``{ image, kind, engine, width, height }``.
    """
    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)

    m = meta or {}
    mask_raw = str(m.get("eraseMask") or m.get("excludeMask") or "").strip()
    if not mask_raw:
        raise ValueError("请先在图片上涂抹要擦除的区域")

    mask_bytes = _decode_data_url_mask(mask_raw)
    png_bytes = await erase_alpha_via_ilp(image, mask_bytes)
    rgba = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    return {
        "image": _png_data_url_from_bytes(png_bytes),
        "kind": "eraser",
        "engine": "ilp:erase-alpha",
        "width": int(rgba.width),
        "height": int(rgba.height),
    }
