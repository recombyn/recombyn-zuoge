"""Smart eraser — Volcengine MediaKit selected-area erase from brush masks."""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any

from PIL import Image

from app.services.vision.mediakit_client import erase_image, mediakit_enabled
from app.services.vision.rehost import encode_or_rehost_image, raster_filename_and_type

logger = logging.getLogger(__name__)

_MEDIAKIT_REQUIRED_MSG = (
    "橡皮工具需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
    "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
)
_DATA_URL_RE = re.compile(r"^data:[^;,]+(?:;base64)?,(.+)$", re.DOTALL)


def _decode_data_url_mask(raw: str) -> bytes:
    ref = (raw or "").strip()
    if not ref:
        raise ValueError("eraseMask is required")
    if not ref.startswith("data:"):
        raise ValueError("eraseMask must be a data URL")
    match = _DATA_URL_RE.match(ref)
    if not match:
        raise ValueError("invalid eraseMask data URL")
    return base64.b64decode(match.group(1))


def mask_to_mediakit_bw_png(mask_bytes: bytes) -> bytes:
    """White = erase, black = keep (MediaKit mask contract)."""
    import numpy as np

    rgba = Image.open(io.BytesIO(mask_bytes)).convert("RGBA")
    arr = np.asarray(rgba)
    alpha = arr[:, :, 3]
    lum = arr[:, :, 0].astype(np.int16) + arr[:, :, 1] + arr[:, :, 2]
    white = (alpha > 8) & (lum > 24)
    if not bool(white.any()):
        raise ValueError("请先在图片上涂抹要擦除的区域")
    out = np.zeros((arr.shape[0], arr.shape[1]), dtype=np.uint8)
    out[white] = 255
    buf = io.BytesIO()
    Image.fromarray(out, mode="L").convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


def _png_bytes_for_canvas(raw: bytes, img: Image.Image, fmt: str) -> bytes:
    """Prefer PNG for canvas round-trip when no upload user."""
    if img.mode == "RGBA" or str(fmt or "").lower() == "png":
        return raw
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return buf.getvalue()


async def smart_erase(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
    user_id: str | None = None,
) -> dict[str, Any]:
    """
    Erase painted regions via MediaKit ``selected_area_erase`` + mask.

    Also accepts auto scenes when meta sets ``standardScene`` without a brush mask
    (e.g. full_screen_text_erase / full_screen_icon_erase).

    Returns ``{ image, kind, engine, mode, width, height }``.
    """
    if not mediakit_enabled():
        raise RuntimeError(_MEDIAKIT_REQUIRED_MSG)

    m = dict(meta or {})
    scene = str(m.get("standardScene") or "").strip()
    mask_raw = str(m.get("eraseMask") or "").strip()
    mask_png: bytes | None = None

    if mask_raw:
        mask_png = mask_to_mediakit_bw_png(_decode_data_url_mask(mask_raw))
        scene = "selected_area_erase"
        m["standardScene"] = scene
    elif not scene:
        raise ValueError("请先在图片上涂抹要擦除的区域")

    m.setdefault("outputFormat", "png")
    out = await erase_image(image, meta=m, mask_bytes=mask_png)
    raw = out["image_bytes"]
    img = Image.open(io.BytesIO(raw))
    width = int(out.get("width") or img.width)
    height = int(out.get("height") or img.height)
    fmt = str(out.get("format") or "png").lower()

    if not user_id:
        raw = _png_bytes_for_canvas(raw, img, fmt)
        fmt = "png"
    filename, content_type = raster_filename_and_type(fmt, stem="eraser")
    image_out = encode_or_rehost_image(
        raw, user_id=user_id, filename=filename, content_type=content_type
    )

    return {
        "image": image_out,
        "kind": "eraser",
        "engine": "mediakit:erase-image",
        "model": f"mediakit:{out.get('scene') or scene}",
        "mode": "mediakit",
        "width": width,
        "height": height,
    }
