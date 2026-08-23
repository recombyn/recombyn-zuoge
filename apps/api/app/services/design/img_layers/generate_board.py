"""Generate a full-board raster for img_layers mode."""

from __future__ import annotations

from typing import Any

from app.services.design.img_layers.prompts import board_image_prompt


def _image_model_id(rules: dict[str, str] | None) -> str:
    from app.services.llm.image import resolve_image_model

    mid = str((rules or {}).get("assets.image_default_model") or "").strip()
    return resolve_image_model(mid or None)


def _resolution_for_model(catalog_id: str) -> str:
    from app.services.llm.image import _catalog_image_limits, _pick_resolution

    limits = _catalog_image_limits(catalog_id)
    return _pick_resolution(None, limits)


async def generate_board_image(
    *,
    prompt: str,
    width: int,
    height: int,
    rules: dict[str, str] | None,
    ref_images: list[str] | None = None,
) -> dict[str, Any]:
    """
    Returns ``{ src, model, width, height }``.
    ``src`` is a https or data URL suitable for decompose + create_image.
    """
    from app.services.llm.image import generate_image

    catalog_id = _image_model_id(rules)
    resolution = _resolution_for_model(catalog_id)
    gen_prompt = board_image_prompt(prompt, width=width, height=height)
    aspect = f"{max(40, int(width))}x{max(40, int(height))}"
    refs = [u for u in (ref_images or []) if isinstance(u, str) and u.strip()][:4]
    result = await generate_image(
        prompt=gen_prompt[:1200],
        model=catalog_id,
        aspect_ratio=aspect,
        quality="standard",
        resolution=resolution,
        images=refs or None,
    )
    url = (result.get("images") or [None])[0]
    if not url:
        raise RuntimeError("img_layers_generate_empty")
    return {
        "src": str(url),
        "model": str(result.get("model") or catalog_id),
        "width": int(width),
        "height": int(height),
    }
