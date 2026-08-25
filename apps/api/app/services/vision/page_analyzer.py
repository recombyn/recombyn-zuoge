"""Analyze page images → text/layout blocks + color palette."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from app.core.config import settings

_ILP_REQUIRED_MSG = (
    "Document import requires Recombyn Intelligence "
    "(set RECOMBYN_INTELLIGENCE_URL and start intelligence)"
)


def analyze_page_images(page_paths: list[Path]) -> dict[str, Any]:
    """
    Run OCR/layout on raster pages for document import via intelligence only.

    Returns blocks (text merged, figures cropped, tables as cells), page size, palette, engines, warnings.
    """
    from app.services.vision.ilp_client import analyze_pages_via_ilp, ilp_enabled

    if not ilp_enabled():
        raise RuntimeError(_ILP_REQUIRED_MSG)
    if not page_paths:
        raise ValueError("no page images for vision analysis")

    try:
        result = analyze_pages_via_ilp(
            page_paths,
            lang=settings.ocr_lang,
            target_width=settings.scene_target_width,
            palette_k=settings.palette_k,
            expand_table_cells=settings.expand_table_cells,
        )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"intelligence analyze-pages failed: {exc}") from exc

    engines = list(result.get("engines") or [])
    if "ilp:analyze-pages" not in engines:
        engines.insert(0, "ilp:analyze-pages")
    result["engines"] = engines
    return result
