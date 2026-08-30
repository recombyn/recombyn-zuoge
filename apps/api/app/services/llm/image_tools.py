"""Image toolbar AI tools — Seedream i2i + Recombyn Intelligence vision."""

from __future__ import annotations

import base64
from collections.abc import Callable
from typing import Any

import logging

import httpx

from app.services.llm.image import generate_image

logger = logging.getLogger(__name__)

# Kinds that return a new raster image for the canvas clone.
IMAGE_PROCESS_KINDS = frozenset(
    {
        "upscale",
        "removeBg",
        "eraser",
        "multiAngle",
        "expand",
        "editText",
        "editElements",
        "detectRegions",
        "replaceText",
        "vector",
        "adjust",
    }
)

# Closed-source intelligence only — hidden in UI and rejected when service is down.
ILP_EXCLUSIVE_KINDS = frozenset(
    {"removeBg", "eraser", "editText", "editElements", "detectRegions", "upscale"}
)

DECOMPOSE_KINDS = frozenset({"editText", "editElements"})
DETECT_KINDS = frozenset({"detectRegions"})
CUTOUT_KINDS = frozenset({"removeBg"})
ERASE_KINDS = frozenset({"eraser"})
UPSCALE_KINDS = frozenset({"upscale"})
VECTOR_KINDS = frozenset({"vector"})
NO_LLM_KINDS = (
    CUTOUT_KINDS | ERASE_KINDS | DECOMPOSE_KINDS | DETECT_KINDS | UPSCALE_KINDS | VECTOR_KINDS
)

_ILP_REQUIRED_MSG = (
    "此功能需要接入 Recombyn Intelligence 闭源服务（设置 RECOMBYN_INTELLIGENCE_URL 并启动 intelligence）"
)


def uses_llm_for_kind(kind: str | None) -> bool:
    """True when ``process_image_tool`` will call Seedream / image LLM."""
    k = (kind or "").strip()
    return bool(k) and k in IMAGE_PROCESS_KINDS and k not in NO_LLM_KINDS


def requires_ilp(kind: str | None) -> bool:
    return (kind or "").strip() in ILP_EXCLUSIVE_KINDS


def _require_ilp() -> None:
    from app.services.vision.ilp_client import ilp_enabled

    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)


def ilp_supports() -> list[str]:
    from app.services.vision.ilp_client import ilp_enabled

    if not ilp_enabled():
        return []
    return ["removeBg", "eraser", "editText", "editElements", "detectRegions", "upscale"]


def _prompt_for(
    kind: str,
    *,
    meta: dict[str, Any] | None = None,
) -> str:
    m = meta or {}
    if kind == "removeBg":
        return "unused"
    if kind == "upscale":
        return (
            "Upscale this image to high resolution. Enhance sharpness and fine detail, "
            "reduce noise, keep the exact composition, identity, and colors unchanged. "
            "No cropping, no restyling."
        )
    if kind == "multiAngle":
        rotate = m.get("rotate", 0)
        tilt = m.get("tilt", 0)
        mode = str(m.get("mode") or "camera")
        if mode == "skybox":
            return (
                f"Based on the reference image, generate an environment / skybox view of the same subject. "
                f"Horizontal yaw about {rotate}°, pitch about {tilt}°. "
                f"Keep subject identity, materials, and lighting style consistent."
            )
        return (
            f"Based on the reference photo, regenerate the same subject from a new camera angle: "
            f"horizontal rotation about {rotate}°, tilt/pitch about {tilt}°. "
            f"Keep face/body/clothing identity and background style; photorealistic."
        )
    if kind == "expand":
        direction = str(m.get("direction") or "all")
        scale = str(m.get("scale") or "1.5x")
        pad_l = int(m.get("padLeft") or 0)
        pad_r = int(m.get("padRight") or 0)
        pad_t = int(m.get("padTop") or 0)
        pad_b = int(m.get("padBottom") or 0)
        tw = m.get("targetWidth")
        th = m.get("targetHeight")
        size_hint = (
            f" Target canvas about {int(tw)}×{int(th)}px."
            if tw and th
            else ""
        )
        pad_hint = ""
        if pad_l or pad_r or pad_t or pad_b:
            pad_hint = (
                f" Extend roughly left={pad_l}px, right={pad_r}px, "
                f"top={pad_t}px, bottom={pad_b}px beyond the original."
            )
        return (
            f"Outpaint / extend the image canvas ({scale}, direction: {direction})."
            f"{size_hint}{pad_hint} "
            f"Continue the scene naturally beyond the edges; match lighting, perspective, and style. "
            f"Do not distort the original subject."
        )
    if kind in ("editText", "editElements", "detectRegions"):
        return "unused"
    if kind == "replaceText":
        original = str(m.get("originalText") or "").strip()
        new = str(m.get("newText") or "").strip()
        if not original or not new:
            raise ValueError("replaceText requires meta.originalText and meta.newText")
        return (
            f"Edit this image in place: replace the visible text \"{original}\" "
            f"with \"{new}\". Keep the same artistic lettering style, brush/calligraphy "
            f"texture, colors, lighting, layout, and background. Do not add extra "
            f"captions, watermarks, or unrelated objects. Only change that text content."
        )
    if kind == "adjust":
        hint = str(m.get("hint") or "balanced exposure, natural contrast and color").strip()
        return (
            f"Apply photographic color/tone adjustment: {hint}. "
            f"Keep composition and subject identity identical; no restyling."
        )
    raise ValueError(f"Unsupported image process kind: {kind}")


def _resolution_for(kind: str, resolution: str | None) -> str | None:
    if kind == "upscale":
        return (resolution or "4K").strip() or "4K"
    return resolution


async def _as_data_url(image_ref: str) -> str:
    """Prefer embeddable data URLs so the canvas does not depend on remote CDN CORS."""
    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("empty image")
    if ref.startswith("data:"):
        return ref
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
        resp = await client.get(ref)
        resp.raise_for_status()
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        if not ctype.startswith("image/"):
            ctype = "image/png"
        b64 = base64.b64encode(resp.content).decode("ascii")
        return f"data:{ctype};base64,{b64}"


async def process_image_tool(
    *,
    kind: str,
    image: str,
    meta: dict[str, Any] | None = None,
    aspect_ratio: str | None = None,
    quality: str | None = None,
    resolution: str | None = None,
    model: str | None = None,
    user_id: str | None = None,
    on_progress: Callable[[int, str], None] | None = None,
) -> dict[str, Any]:
    """
    Run a toolbar image tool.

    - ``removeBg`` / ``editText`` / ``editElements`` / ``upscale`` → Recombyn Intelligence only
    - ``vector`` → local vtracer (SVG markup)
    - other kinds → Seedream image-to-image

    Returns ``{ image?, svg?, layers?, text?, kind, model?, width?, height?, warnings? }``.
    """
    k = (kind or "").strip()
    if k not in IMAGE_PROCESS_KINDS:
        raise ValueError(f"Unsupported kind: {kind}")
    src = (image or "").strip()
    if not src:
        raise ValueError("image is required")

    if requires_ilp(k):
        _require_ilp()

    if k in VECTOR_KINDS:
        from app.services.vision.vtracer_vectorize import vectorize_with_vtracer

        return await vectorize_with_vtracer(src, meta=meta)

    if k in CUTOUT_KINDS:
        from app.services.vision.remove_bg import remove_background

        return await remove_background(src, meta=meta, user_id=user_id)

    if k in ERASE_KINDS:
        from app.services.vision.smart_erase import smart_erase

        return await smart_erase(src, meta=meta)

    if k == "editElements":
        from app.services.vision.ilp_decompose import decompose_via_ilp

        return await decompose_via_ilp(
            kind="editElements",
            image=src,
            user_id=user_id,
            on_progress=on_progress,
        )

    if k == "editText":
        from app.services.vision.ilp_text_decompose import decompose_text_via_ilp

        return await decompose_text_via_ilp(kind="editText", image=src, user_id=user_id)

    if k in DETECT_KINDS:
        from app.services.vision.ilp_detect_regions import detect_regions_via_ilp_adapter

        return await detect_regions_via_ilp_adapter(image=src)

    if k in UPSCALE_KINDS:
        from app.services.vision.ilp_upscale import upscale_image_via_ilp

        return await upscale_image_via_ilp(src, meta=meta, resolution=resolution)

    prompt = _prompt_for(k, meta=meta)
    result = await generate_image(
        prompt=prompt,
        model=model,
        aspect_ratio=aspect_ratio,
        quality=quality or "high",
        resolution=_resolution_for(k, resolution),
        images=[src],
    )
    images = result.get("images") or []
    if not images:
        raise RuntimeError("Image tool returned no images")
    out = await _as_data_url(str(images[0]))
    return {
        "image": out,
        "text": result.get("text"),
        "kind": k,
        "model": result.get("model"),
    }
