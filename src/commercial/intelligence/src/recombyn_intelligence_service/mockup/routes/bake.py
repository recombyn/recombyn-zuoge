"""Bake mockup template asset bundles from studio photography."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import JSONResponse

from mockup_pipeline.bake import bake_mockup_template_from_photo, save_template_bundle
from recombyn_intelligence_service.mockup.config import settings
from recombyn_intelligence_service.vision.deps import require_auth

router = APIRouter(
  prefix="/mockup",
  tags=["mockup-bake"],
  dependencies=[Depends(require_auth)],
)


@router.post("/bake")
async def bake_template(
  photo: UploadFile = File(...),
  mask: UploadFile = File(...),
  template_id: str = Form("baked-mug"),
  name: str = Form("Baked mug"),
  use_tps: bool = Form(True),
  glass: bool = Form(False),
  persist: bool = Form(True),
):
  """
  Offline asset calibration: decouple shadow/highlight/UV from product photo.

  When persist=true, writes bundle under MOCKUP_TEMPLATES_DIR/{template_id}/.
  """
  with tempfile.TemporaryDirectory() as td:
    root = Path(td)
    photo_path = root / "photo.png"
    mask_path = root / "mask.png"
    photo_path.write_bytes(await photo.read())
    mask_path.write_bytes(await mask.read())
    template = bake_mockup_template_from_photo(
      photo_path,
      mask_path,
      template_id=template_id.strip() or "baked-mug",
      name=name.strip() or template_id,
      use_tps=use_tps,
      glass=glass,
    )
    out_dir = settings.templates_dir / template.template_id
    if persist:
      save_template_bundle(template, out_dir)
    return JSONResponse(
      {
        "template_id": template.template_id,
        "name": template.name,
        "width": template.width,
        "height": template.height,
        "persisted": persist,
        "path": str(out_dir) if persist else None,
        "meta": template.meta,
      }
    )
