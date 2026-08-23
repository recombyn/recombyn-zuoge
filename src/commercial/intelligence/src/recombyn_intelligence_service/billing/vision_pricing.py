"""Vision pipeline credit floors — closed-source matting / OCR / upscale."""

from __future__ import annotations

from recombyn_protocol.billing import TaskPricingSchema

# Keys align with BFF image tool kinds and quote ``mode`` values.
DEFAULT_VISION_CREDIT_FLOORS: dict[str, int] = {
    "removeBg": 2,
    "upscale": 3,
    "eraser": 0,
    "editText": 3,
    "editElements": 4,
    "detectRegions": 1,
    "analyze-pages": 2,
    "mockup": 2,
}


def default_vision_task_pricing_catalog() -> dict[str, TaskPricingSchema]:
    """Authorize floors for intelligence vision endpoints."""
    out: dict[str, TaskPricingSchema] = {}
    for kind, credits in DEFAULT_VISION_CREDIT_FLOORS.items():
        mode = f"vision_{kind.replace('-', '_')}"
        out[mode] = TaskPricingSchema(
            task_pricing_id=f"tp_vision_{kind.replace('-', '_')}",
            task_type="image",
            pipeline=f"vision/{kind}",
            base_credit=max(1, int(credits)),
            steps=[],
            notes=f"Intelligence vision: {kind}",
        )
    return out


def vision_credit_floor(mode: str) -> int | None:
    """Resolve credit floor for ``mode`` (``vision_removeBg`` or ``removeBg``)."""
    key = str(mode or "").strip()
    if not key:
        return None
    if key.startswith("vision_"):
        key = key[7:]
    key = key.replace("_", "-")
    # normalize camelCase kinds
    aliases = {
        "remove_bg": "removeBg",
        "edit_text": "editText",
        "edit_elements": "editElements",
        "detect_regions": "detectRegions",
        "analyze_pages": "analyze-pages",
    }
    key = aliases.get(key, key)
    val = DEFAULT_VISION_CREDIT_FLOORS.get(key)
    return int(val) if val is not None else None
