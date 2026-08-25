"""Map Image Layer Pipeline job output → editElements decompose response."""

from __future__ import annotations

import io
import logging
from collections.abc import Callable
from typing import Any, Literal

from PIL import Image

from app.services.vision.ilp_client import (
    bytes_to_data_url,
    create_job,
    fetch_file_bytes,
    ilp_enabled,
    wait_for_job,
)
from app.services.vision.rehost import rehost_image_bytes

logger = logging.getLogger(__name__)

EditMode = Literal["editElements", "editText"]

_LAYER_SPECS: tuple[tuple[str, str], ...] = (
    ("far_background", "远景底图"),
    ("midground", "中景"),
    ("foreground", "前景"),
)


def _size_from_meta(meta: dict[str, Any]) -> tuple[int, int]:
    size = meta.get("size") or []
    if isinstance(size, (list, tuple)) and len(size) >= 2:
        h = int(size[0] or 0)
        w = int(size[1] or 0)
        if w > 0 and h > 0:
            return w, h
    return 0, 0


def _size_from_bytes(content: bytes) -> tuple[int, int]:
    with Image.open(io.BytesIO(content)) as img:
        return int(img.width), int(img.height)


async def decompose_via_ilp(
    *,
    kind: EditMode,
    image: str,
    user_id: str | None = None,
    on_progress: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    """Run closed-source subject pipeline; returns BFF layer payload.

    Returns ``{ image, layers, kind, width, height, engines, warnings }``.
    """
    if kind != "editElements":
        raise ValueError("ILP decompose only supports editElements")
    if not ilp_enabled():
        raise RuntimeError("Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)")

    job_id = await create_job(image)
    logger.info("ILP job created: %s", job_id)
    job = await wait_for_job(job_id, on_progress=on_progress)
    status = str(job.get("status") or "")
    if status == "failed":
        raise RuntimeError(str(job.get("error") or "ILP job failed"))
    if status not in ("needs_review", "done"):
        raise RuntimeError(f"unexpected ILP status: {status}")

    meta = job.get("meta") if isinstance(job.get("meta"), dict) else {}
    w, h = _size_from_meta(meta)
    urls = job.get("urls") if isinstance(job.get("urls"), dict) else {}

    layers: list[dict[str, Any]] = []
    for key, name in _LAYER_SPECS:
        rel = urls.get(key)
        if not rel:
            continue
        content, ctype = await fetch_file_bytes(str(rel))
        if w <= 0 or h <= 0:
            w, h = _size_from_bytes(content)
        src = rehost_image_bytes(
            user_id,
            content,
            filename=f"editElements-{key}.png",
            content_type=ctype or "image/png",
        ) or bytes_to_data_url(content, ctype)
        layers.append(
            {
                "type": "image",
                "src": src,
                "x": 0.0,
                "y": 0.0,
                "width": float(w),
                "height": float(h),
                "name": name,
            }
        )

    if not layers:
        raise RuntimeError("ILP returned no exportable layers")

    return {
        "image": layers[0]["src"],
        "layers": layers,
        "kind": kind,
        "width": w,
        "height": h,
        "engines": ["ilp:depth+birefnet+lama"],
        "warnings": [],
    }
