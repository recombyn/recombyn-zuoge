"""Raster → SVG via vtracer (local, no LLM)."""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Any

import httpx
from PIL import Image

logger = logging.getLogger(__name__)

_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(?:;base64)?,(.+)$", re.DOTALL)


async def _load_image_bytes(image_ref: str) -> tuple[bytes, str]:
    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")
    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise ValueError("invalid image data URL")
        ctype = (match.group(1) or "image/png").split(";")[0].strip() or "image/png"
        return base64.b64decode(match.group(2)), ctype

    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(ref)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/png"
        return resp.content, ctype


def _img_format(content_type: str) -> str:
    ctype = (content_type or "").lower()
    if "jpeg" in ctype or "jpg" in ctype:
        return "jpg"
    if "webp" in ctype:
        return "webp"
    if "gif" in ctype:
        return "gif"
    return "png"


def _trace_svg(png_or_raw: bytes, img_format: str, meta: dict[str, Any] | None) -> str:
    import vtracer

    m = meta or {}
    colormode = str(m.get("colormode") or m.get("colorMode") or "color").strip().lower()
    if colormode not in ("color", "binary"):
        colormode = "color"
    hierarchical = str(m.get("hierarchical") or "stacked").strip().lower()
    if hierarchical not in ("stacked", "cutout"):
        hierarchical = "stacked"
    mode = str(m.get("mode") or "spline").strip().lower()
    if mode not in ("spline", "polygon", "none"):
        mode = "spline"

    filter_speckle = int(m.get("filterSpeckle") if m.get("filterSpeckle") is not None else 4)
    color_precision = int(m.get("colorPrecision") if m.get("colorPrecision") is not None else 6)
    layer_difference = int(m.get("layerDifference") if m.get("layerDifference") is not None else 16)
    corner_threshold = int(m.get("cornerThreshold") if m.get("cornerThreshold") is not None else 60)
    length_threshold = float(m.get("lengthThreshold") if m.get("lengthThreshold") is not None else 4.0)
    max_iterations = int(m.get("maxIterations") if m.get("maxIterations") is not None else 10)
    splice_threshold = int(m.get("spliceThreshold") if m.get("spliceThreshold") is not None else 45)
    path_precision = int(m.get("pathPrecision") if m.get("pathPrecision") is not None else 3)

    svg = vtracer.convert_raw_image_to_svg(
        png_or_raw,
        img_format=img_format,
        colormode=colormode,
        hierarchical=hierarchical,
        mode=mode,
        filter_speckle=filter_speckle,
        color_precision=color_precision,
        layer_difference=layer_difference,
        corner_threshold=corner_threshold,
        length_threshold=length_threshold,
        max_iterations=max_iterations,
        splice_threshold=splice_threshold,
        path_precision=path_precision,
    )
    out = str(svg or "").strip()
    if not out:
        raise RuntimeError("vtracer returned empty SVG")
    return out


async def vectorize_with_vtracer(
    image: str,
    *,
    meta: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Trace a raster image to SVG markup.

    Returns ``{ svg, kind, engine, width, height }`` (no raster ``image``).
    """
    raw, ctype = await _load_image_bytes(image)
    rgba = Image.open(io.BytesIO(raw)).convert("RGBA")
    # Normalize to PNG bytes so vtracer always gets a decodable buffer.
    buf = io.BytesIO()
    rgba.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    svg = _trace_svg(png_bytes, "png", meta)
    return {
        "svg": svg,
        "kind": "vector",
        "engine": "vtracer",
        "width": int(rgba.width),
        "height": int(rgba.height),
    }
