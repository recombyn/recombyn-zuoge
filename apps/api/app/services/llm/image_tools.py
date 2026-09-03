"""Image toolbar AI tools — MediaKit + WaveSpeed + Seedream + local CV."""

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
        "replaceText",
        "translateImage",
        "productScene",
        "vector",
    }
)

MEDIAKIT_KINDS = frozenset(
    {
        "removeBg",
        "expand",
        "editText",
        "eraser",
        "upscale",
        "translateImage",
        "productScene",
    }
)

WAVESPEED_KINDS = frozenset({"multiAngle"})
EDIT_ELEMENTS_KINDS = frozenset({"editElements"})

DECOMPOSE_KINDS = frozenset({"editText", "editElements"})
CUTOUT_KINDS = frozenset({"removeBg"})
EXPAND_KINDS = frozenset({"expand"})
ERASE_KINDS = frozenset({"eraser"})
UPSCALE_KINDS = frozenset({"upscale"})
TRANSLATE_KINDS = frozenset({"translateImage"})
PRODUCT_SCENE_KINDS = frozenset({"productScene"})
MULTI_ANGLE_KINDS = frozenset({"multiAngle"})
VECTOR_KINDS = frozenset({"vector"})
NO_LLM_KINDS = (
    CUTOUT_KINDS
    | EXPAND_KINDS
    | ERASE_KINDS
    | DECOMPOSE_KINDS
    | UPSCALE_KINDS
    | TRANSLATE_KINDS
    | PRODUCT_SCENE_KINDS
    | MULTI_ANGLE_KINDS
    | VECTOR_KINDS
)


def uses_llm_for_kind(kind: str | None) -> bool:
    """True when ``process_image_tool`` will call Seedream / image LLM."""
    k = (kind or "").strip()
    return bool(k) and k in IMAGE_PROCESS_KINDS and k not in NO_LLM_KINDS


def requires_mediakit(kind: str | None) -> bool:
    return (kind or "").strip() in MEDIAKIT_KINDS


def requires_wavespeed(kind: str | None) -> bool:
    k = (kind or "").strip()
    if k in WAVESPEED_KINDS:
        return True
    if k in EDIT_ELEMENTS_KINDS:
        from app.core.config import settings

        return (
            str(settings.vision_edit_elements_provider or "seedream").strip().lower()
            == "wavespeed"
        )
    return False


def requires_seedream_layers(kind: str | None) -> bool:
    k = (kind or "").strip()
    if k not in EDIT_ELEMENTS_KINDS:
        return False
    from app.core.config import settings

    return (
        str(settings.vision_edit_elements_provider or "seedream").strip().lower()
        == "seedream"
    )


def _require_mediakit() -> None:
    from app.services.vision.mediakit_client import mediakit_enabled

    if not mediakit_enabled():
        raise RuntimeError(
            "此功能需要配置火山引擎 AI MediaKit（设置 MEDIAKIT_API_KEY，"
            "见 https://console.volcengine.com/imp/ai-mediakit/settings）"
        )


def _require_wavespeed() -> None:
    from app.services.vision.providers.registry import wavespeed_enabled

    if not wavespeed_enabled():
        raise RuntimeError(
            "此功能需要配置 WaveSpeedAI（设置 WAVESPEED_API_KEY，"
            "见 https://wavespeed.ai/）"
        )


def _require_seedream_layers() -> None:
    from app.services.vision.providers.registry import seedream_enabled

    if not seedream_enabled():
        raise RuntimeError(
            "此功能需要配置豆包方舟（设置 DOUBAO_API_KEY，"
            "见 https://console.volcengine.com/ark）"
        )


def mediakit_supports() -> list[str]:
    from app.services.vision.mediakit_client import mediakit_supports as _supports

    return _supports()


def wavespeed_supports() -> list[str]:
    from app.services.vision.providers.registry import wavespeed_supports as _supports

    return _supports()


def seedream_supports() -> list[str]:
    from app.services.vision.providers.registry import seedream_supports as _supports

    return _supports()


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
    if kind in ("editText", "editElements", "multiAngle"):
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

    - MediaKit / WaveSpeed / Seedream layered / local vtracer / Seedream i2i

    Returns ``{ image?, images?, svg?, layers?, text?, kind, model?, width?, height?, warnings? }``.
    """
    k = (kind or "").strip()
    if k not in IMAGE_PROCESS_KINDS:
        raise ValueError(f"Unsupported kind: {kind}")
    src = (image or "").strip()
    if not src:
        raise ValueError("image is required")

    if requires_mediakit(k):
        _require_mediakit()
    if requires_wavespeed(k):
        _require_wavespeed()
    if requires_seedream_layers(k):
        _require_seedream_layers()

    if k in VECTOR_KINDS:
        from app.services.vision.vtracer_vectorize import vectorize_with_vtracer

        return await vectorize_with_vtracer(src, meta=meta)

    if k in CUTOUT_KINDS:
        from app.services.vision.remove_bg import remove_background

        return await remove_background(src, meta=meta, user_id=user_id)

    if k in EXPAND_KINDS:
        from app.services.vision.expand_canvas import expand_canvas

        return await expand_canvas(src, meta=meta, user_id=user_id)

    if k in ERASE_KINDS:
        from app.services.vision.smart_erase import smart_erase

        return await smart_erase(src, meta=meta, user_id=user_id)

    if k == "editElements":
        from app.services.vision.edit_elements import edit_elements_layered

        return await edit_elements_layered(
            src,
            meta=meta,
            user_id=user_id,
            on_progress=on_progress,
        )

    if k in MULTI_ANGLE_KINDS:
        from app.services.vision.multi_angle import multi_angle_image

        return await multi_angle_image(
            src,
            meta=meta,
            user_id=user_id,
            on_progress=on_progress,
        )

    if k == "editText":
        from app.services.vision.edit_text import decompose_edit_text

        return await decompose_edit_text(src, meta=meta, user_id=user_id)

    if k in UPSCALE_KINDS:
        from app.services.vision.upscale import upscale_image

        return await upscale_image(
            src, meta=meta, resolution=resolution, user_id=user_id
        )

    if k in TRANSLATE_KINDS:
        from app.services.vision.translate_image import translate_image

        return await translate_image(src, meta=meta, user_id=user_id)

    if k in PRODUCT_SCENE_KINDS:
        from app.services.vision.product_scene import product_scene

        return await product_scene(src, meta=meta, user_id=user_id)

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
