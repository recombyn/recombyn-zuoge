"""List available mockup templates."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from mockup_pipeline.loader import list_templates
from recombyn_intelligence_service.mockup.config import settings
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(
    prefix="/mockup",
    tags=["mockup-templates"],
    dependencies=[Depends(require_auth)],
)


@router.get("/templates")
async def get_templates():
    return {"templates": list_templates(settings.templates_dir)}
