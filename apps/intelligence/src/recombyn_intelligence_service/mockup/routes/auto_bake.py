"""Auto-bake mockup kit from a product photo (no hand mask)."""

from __future__ import annotations

import base64
import binascii
import re

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from recombyn_intelligence_service.mockup.services.auto_bake_service import build_auto_bake_kit
from recombyn_intelligence_service.vision.deps import require_auth
from recombyn_intelligence_service.vision.services.segment_service import segment_foreground_rgba

router = APIRouter(
  prefix="/mockup",
  tags=["mockup-auto-bake"],
  dependencies=[Depends(require_auth)],
)

_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(;base64)?,(.*)$", re.DOTALL)


def _decode_data_url_or_raw(raw: str) -> bytes:
  s = (raw or "").strip()
  if not s:
    raise ValueError("empty image")
  m = _DATA_URL_RE.match(s)
  if m:
    payload = m.group(3)
    if m.group(2):
      return base64.b64decode(payload)
    from urllib.parse import unquote_to_bytes

    return unquote_to_bytes(payload)
  try:
    return base64.b64decode(s, validate=True)
  except binascii.Error as exc:
    raise ValueError("image must be data-url or base64") from exc


class AutoBakeBody(BaseModel):
  image: str = Field(..., description="Product photo as data-URL or base64")
  scale: float = Field(0.5, ge=0.25, le=1.0)


@router.post("/auto-bake")
async def auto_bake_json(body: AutoBakeBody):
  """
  Full-auto: segment subjects → printable zones → UV + shadow/highlight kit.

  Printable masks are internal (never drawn in product UI).
  """
  try:
    photo = _decode_data_url_or_raw(body.image)
    matte_png, engines = segment_foreground_rgba(photo)
    kit = build_auto_bake_kit(photo, matte_png, scale=float(body.scale), engines=engines)
    return JSONResponse(kit)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/auto-bake/upload")
async def auto_bake_upload(
  photo: UploadFile = File(...),
  scale: float = Form(0.5),
):
  try:
    raw = await photo.read()
    if not raw:
      raise ValueError("empty upload")
    matte_png, engines = segment_foreground_rgba(raw)
    kit = build_auto_bake_kit(raw, matte_png, scale=float(scale), engines=engines)
    return JSONResponse(kit)
  except ValueError as exc:
    raise HTTPException(status_code=400, detail=str(exc)) from exc
