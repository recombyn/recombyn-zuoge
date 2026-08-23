"""Document import page analysis — OCR/layout blocks for resume import."""

from __future__ import annotations

from typing import Any

from image_layer_pipeline.stages.page_import import analyze_page_images_bytes


def analyze_pages(
    pages: list[bytes],
    *,
    lang: str = "ch",
    target_width: int = 794,
    palette_k: int = 5,
    expand_table_cells: bool = True,
) -> dict[str, Any]:
    return analyze_page_images_bytes(
        pages,
        lang=lang.strip() or "ch",
        target_width=max(1, int(target_width)),
        palette_k=max(1, int(palette_k)),
        expand_table_cells=bool(expand_table_cells),
    )
