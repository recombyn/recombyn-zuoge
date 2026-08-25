"""List available mockup templates + FE preview kit."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from mockup_pipeline.loader import list_templates
from recombyn_intelligence_service.mockup.config import settings
from recombyn_intelligence_service.mockup.services.kit_service import build_template_kit
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(
    prefix="/mockup",
    tags=["mockup-templates"],
    dependencies=[Depends(require_auth)],
)


@router.get("/templates")
async def get_templates():
    return {"templates": list_templates(settings.templates_dir)}


@router.get("/templates/{template_id}/kit")
async def get_template_kit(
    template_id: str,
    scale: float = Query(0.5, ge=0.25, le=1.0),
):
    """UV + mask + base for frontend WebGL live remap (no per-drag render)."""
    try:
        return build_template_kit(
            template_id,
            templates_dir=settings.templates_dir,
            scale=scale,
        )
    except KeyError as err:
        raise HTTPException(status_code=404, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err)) from err
