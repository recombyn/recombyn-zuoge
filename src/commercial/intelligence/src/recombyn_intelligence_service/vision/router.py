from fastapi import APIRouter

from recombyn_intelligence_service.vision.routes import (
    analyze_pages,
    detect_regions,
    erase_alpha,
    eraser,
    inpaint,
    pipeline_jobs,
    refine,
    segment,
    text_decompose,
    upscale,
    uploads,
)

api_router = APIRouter()
api_router.include_router(uploads.router)
api_router.include_router(pipeline_jobs.router)
api_router.include_router(segment.router)
api_router.include_router(upscale.router)
api_router.include_router(eraser.router)
api_router.include_router(erase_alpha.router)
api_router.include_router(inpaint.router)
api_router.include_router(text_decompose.router)
api_router.include_router(detect_regions.router)
api_router.include_router(analyze_pages.router)
api_router.include_router(refine.router)
