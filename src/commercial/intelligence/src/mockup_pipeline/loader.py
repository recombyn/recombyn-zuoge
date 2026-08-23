"""Load mockup templates from builtin registry or on-disk asset bundles."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from mockup_pipeline.templates_builtin import get_builtin_template, list_builtin_templates
from mockup_pipeline.types import FresnelParams, MockupTemplate


def list_templates(templates_dir: Path | None = None) -> list[dict[str, str | int | bool]]:
  items = list_builtin_templates()
  root = templates_dir
  if root and root.is_dir():
    for child in sorted(root.iterdir()):
      if not child.is_dir():
        continue
      meta_path = child / "meta.json"
      if not meta_path.is_file():
        continue
      try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
      except (OSError, json.JSONDecodeError):
        continue
      items.append(
        {
          "id": str(meta.get("id") or child.name),
          "name": str(meta.get("name") or child.name),
          "kind": "asset",
          "width": int(meta.get("width") or 0),
          "height": int(meta.get("height") or 0),
          "glass": bool(meta.get("fresnel", {}).get("transparency", 0) > 0.1),
        }
      )
  return items


def _read_rgb01(path: Path) -> np.ndarray:
  bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
  if bgr is None:
    raise ValueError(f"could not read image: {path}")
  rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
  return rgb


def _read_gray01(path: Path) -> np.ndarray:
  gray = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
  if gray is None:
    raise ValueError(f"could not read mask: {path}")
  return (gray.astype(np.float32) / 255.0)[:, :, np.newaxis]


def _parse_fresnel(meta: dict) -> FresnelParams | None:
  raw = meta.get("fresnel")
  if not isinstance(raw, dict):
    return None
  return FresnelParams(
    f0=float(raw.get("f0", 0.04)),
    power=float(raw.get("power", 5.0)),
    transparency=float(raw.get("transparency", 0.0)),
  )


def load_template(template_id: str, templates_dir: Path | None = None) -> MockupTemplate:
  tid = template_id.strip()
  try:
    return get_builtin_template(tid)
  except KeyError:
    pass

  root = templates_dir
  if not root:
    raise KeyError(f"unknown template: {template_id}")

  bundle = root / tid
  if not bundle.is_dir():
    raise KeyError(f"unknown template: {template_id}")

  meta_path = bundle / "meta.json"
  meta: dict = {}
  if meta_path.is_file():
    meta = json.loads(meta_path.read_text(encoding="utf-8"))

  base = _read_rgb01(bundle / "base.png")
  h, w = base.shape[:2]
  mask = _read_gray01(bundle / "mask.png")
  shadow = _read_rgb01(bundle / "shadow.png")
  highlight = _read_rgb01(bundle / "highlight.png")

  uv_path = bundle / "uv.npy"
  if not uv_path.is_file():
    raise ValueError(f"missing uv.npy for template {tid}")
  uv_map = np.load(uv_path).astype(np.float32)
  if uv_map.shape[:2] != (h, w):
    raise ValueError("uv map size mismatch")

  disp_path = bundle / "displacement.npy"
  displacement = np.load(disp_path).astype(np.float32) if disp_path.is_file() else None

  env_path = bundle / "env.png"
  env_reflection = _read_rgb01(env_path) if env_path.is_file() else None

  normal_path = bundle / "normal.png"
  normal_map = _read_rgb01(normal_path) if normal_path.is_file() else None

  tps_xy = np.load(bundle / "tps_xy.npy").astype(np.float32) if (bundle / "tps_xy.npy").is_file() else None
  tps_uv = np.load(bundle / "tps_uv.npy").astype(np.float32) if (bundle / "tps_uv.npy").is_file() else None

  return MockupTemplate(
    template_id=tid,
    name=str(meta.get("name") or tid),
    base_image=base,
    uv_map=uv_map,
    mask=mask,
    shadow_map=shadow,
    highlight_map=highlight,
    displacement_map=displacement,
    env_reflection_map=env_reflection,
    normal_map=normal_map,
    fresnel=_parse_fresnel(meta),
    tps_control_xy=tps_xy,
    tps_control_uv=tps_uv,
    meta=meta,
  )
