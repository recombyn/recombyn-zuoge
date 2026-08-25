"""Unit tests for auto printable-region detection + auto-bake serialization."""

from __future__ import annotations

import base64
import io

import cv2
import numpy as np
from PIL import Image

from mockup_pipeline.auto_regions import (
  detect_printable_regions,
  printable_mask_from_subject,
  split_subject_masks,
)
from mockup_pipeline.bake_auto import bake_auto_from_photo_and_matte, photometric_maps_from_rgb
from recombyn_intelligence_service.mockup.services.auto_bake_service import serialize_auto_kit


def _two_blob_mask(h=200, w=300) -> np.ndarray:
  m = np.zeros((h, w), dtype=np.float32)
  m[20:160, 20:100] = 1.0  # tall can-like
  m[40:140, 180:270] = 1.0  # second subject
  return m


def test_split_subject_masks_finds_two():
  subjects = split_subject_masks(_two_blob_mask(), min_area_frac=0.01)
  assert len(subjects) == 2


def test_printable_band_for_tall_subject():
  h, w = 200, 80
  subj = np.zeros((h, w), dtype=np.float32)
  subj[10:190, 10:70] = 1.0
  printable, bbox = printable_mask_from_subject(subj)
  assert printable.sum() > 0
  assert bbox[3] < h  # band shorter than full subject


def test_detect_printable_regions_multi():
  regions = detect_printable_regions(_two_blob_mask(), min_area_frac=0.01)
  assert len(regions) >= 2
  ids = {r.region_id for r in regions}
  assert "r0" in ids


def test_photometric_maps_shapes():
  rgb = np.random.rand(64, 48, 3).astype(np.float32)
  maps = photometric_maps_from_rgb(rgb)
  assert maps["shadow_map"].shape == (64, 48, 3)
  assert maps["highlight_map"].shape == (64, 48, 3)


def test_bake_auto_and_serialize_kit():
  # Synthetic photo + RGBA matte with two blobs.
  photo = Image.new("RGB", (120, 160), (180, 40, 40))
  buf = io.BytesIO()
  photo.save(buf, format="PNG")
  photo_bytes = buf.getvalue()

  rgba = np.zeros((160, 120, 4), dtype=np.uint8)
  rgba[:, :, :3] = 200
  rgba[20:140, 15:50, 3] = 255
  rgba[30:120, 70:105, 3] = 255
  ok, enc = cv2.imencode(".png", cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
  assert ok
  matte_png = enc.tobytes()

  base_rgb, regions, notes = bake_auto_from_photo_and_matte(photo_bytes, matte_png)
  assert base_rgb.shape[0] == 160
  assert len(regions) >= 1
  assert notes

  kit = serialize_auto_kit(base_rgb, regions, scale=0.5)
  assert kit["auto"] is True
  assert kit["width"] >= 32
  assert kit["mask"].startswith("data:image/png")
  assert kit["shadow"].startswith("data:image/png")
  assert kit["highlight"].startswith("data:image/png")
  assert isinstance(kit["regions"], list) and len(kit["regions"]) >= 1
  uv = base64.b64decode(kit["uvBase64"])
  assert len(uv) >= kit["width"] * kit["height"] * 8
