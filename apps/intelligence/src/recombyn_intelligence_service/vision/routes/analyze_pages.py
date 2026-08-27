"""Document import — analyze raster pages into layout blocks."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile

from recombyn_intelligence_service.vision.async_offload import run_sync
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.analyze_pages_service import analyze_pages

router = APIRouter(
    prefix="/pipeline",
    tags=["pipeline-analyze-pages"],
    dependencies=[Depends(require_auth)],
)


@router.post("/analyze-pages")
async def analyze_pages_route(
    files: list[UploadFile] = File(...),
    lang: str = Form("ch"),
    target_width: int = Form(794),
    palette_k: int = Form(5),
    expand_table_cells: bool = Form(True),
):
    """OCR/layout analysis for document import (multi-page supported)."""
    pages: list[bytes] = []
    for upload in files:
        raw = await upload.read()
        if raw:
            pages.append(raw)
    return await run_sync(
        analyze_pages,
        pages,
        lang=lang,
        target_width=target_width,
        palette_k=palette_k,
        expand_table_cells=expand_table_cells,
    )
