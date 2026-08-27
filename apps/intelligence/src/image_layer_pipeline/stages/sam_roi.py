"""Coarse ROI proposals — FastSAM (optional) or OpenCV GrabCut fallback."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from image_layer_pipeline.runtime import hold_inference
from image_layer_pipeline.stages.subpixel import snap_inset


@dataclass
class SamRegion:
    """Axis-aligned proposal in source-pixel coordinates."""

    x: float
    y: float
    width: float
    height: float
    score: float
    id: str = ""
    label: str = "region"
    source: str = "opencv"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "score": self.score,
            "label": self.label,
            "source": self.source,
        }


def _env_flag(name: str, default: bool = False) -> bool:
    raw = str(os.environ.get(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def sam_enabled() -> bool:
    mode = str(os.environ.get("ILP_SAM_BACKEND", "auto") or "auto").strip().lower()
    return mode not in {"off", "disabled", "none"}


def sam_backend_name() -> str:
    return _resolve_backend()


def _resolve_backend() -> str:
    mode = str(os.environ.get("ILP_SAM_BACKEND", "auto") or "auto").strip().lower()
    if mode in {"off", "disabled", "none"}:
        return "off"
    if mode == "opencv":
        return "opencv"
    if mode == "fastsam":
        return "fastsam"
    if mode == "edgesam":
        return "edgesam"
    try:
        from image_layer_pipeline.stages.edgesam_onnx import edgesam_available

        if edgesam_available():
            return "edgesam"
    except Exception:
        pass
    if _fastsam_available():
        return "fastsam"
    return "opencv"


def _fastsam_available() -> bool:
    try:
        import ultralytics  # noqa: F401
    except ImportError:
        return False
    return _resolve_fastsam_model() is not None or _env_flag("ILP_FASTSAM_ALLOW_DOWNLOAD", False)


def _resolve_fastsam_model() -> Path | None:
    raw = str(os.environ.get("ILP_FASTSAM_MODEL_PATH", "") or "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return p
    repo = Path(__file__).resolve().parents[3]
    for candidate in (
        repo / "models" / "FastSAM-s.pt",
        repo / "models" / "FastSAM-x.pt",
    ):
        if candidate.is_file():
            return candidate
    return None


@lru_cache(maxsize=1)
def _load_fastsam():
    from ultralytics import FastSAM

    path = _resolve_fastsam_model()
    if path is None:
        raise RuntimeError(
            "FastSAM weights not found (set ILP_FASTSAM_MODEL_PATH or place models/FastSAM-s.pt)"
        )
    with hold_inference("sam"):
        return FastSAM(str(path))


def _bbox_from_mask(mask: np.ndarray, *, max_w: int, max_h: int, pad: float = 1.0) -> tuple[int, int, int, int] | None:
    if mask.ndim != 2:
        return None
    ys, xs = np.where(mask > 0)
    if ys.size == 0:
        return None
    x0_f, x1_f = float(xs.min()), float(xs.max()) + 1.0
    y0_f, y1_f = float(ys.min()), float(ys.max()) + 1.0
    return snap_inset(x0_f, y0_f, x1_f - x0_f, y1_f - y0_f, pad=pad, max_w=max_w, max_h=max_h)


def _region_from_bbox(
    x: int,
    y: int,
    w: int,
    h: int,
    *,
    score: float,
    label: str,
    source: str,
    idx: int,
) -> SamRegion | None:
    if w < 8 or h < 8:
        return None
    return SamRegion(
        x=float(x),
        y=float(y),
        width=float(w),
        height=float(h),
        score=float(score),
        id=f"sam-{idx}",
        label=label,
        source=source,
    )


def _opencv_proposals(image_rgb: np.ndarray, *, max_regions: int = 8) -> list[SamRegion]:
    h, w = image_rgb.shape[:2]
    proposals: list[SamRegion] = []
    seeds = (
        (0.08, 0.08, 0.84, 0.84, 0.9, "subject"),
        (0.02, 0.02, 0.96, 0.96, 0.75, "scene"),
    )
    for i, (mx, my, mw, mh, score, label) in enumerate(seeds):
        rect = (int(w * mx), int(h * my), int(w * mw), int(h * mh))
        mask = np.zeros((h, w), np.uint8)
        bgd = np.zeros((1, 65), np.float64)
        fgd = np.zeros((1, 65), np.float64)
        try:
            cv2.grabCut(image_rgb, mask, rect, bgd, fgd, 2, cv2.GC_INIT_WITH_RECT)
        except cv2.error:
            continue
        fg = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        box = _bbox_from_mask(fg, max_w=w, max_h=h, pad=2.0)
        if not box:
            continue
        region = _region_from_bbox(*box, score=score, label=label, source="opencv-grabcut", idx=i)
        if region:
            proposals.append(region)

    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
    edges = cv2.Canny(gray, 60, 180)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    areas = sorted(
        ((cv2.contourArea(c), c) for c in contours),
        key=lambda row: row[0],
        reverse=True,
    )
    for j, (area, contour) in enumerate(areas[: max_regions * 2]):
        if area < max(400, h * w * 0.002):
            continue
        x, y, bw, bh = cv2.boundingRect(contour)
        region = _region_from_bbox(
            x,
            y,
            bw,
            bh,
            score=min(0.85, area / float(h * w)),
            label="region",
            source="opencv-contour",
            idx=100 + j,
        )
        if region:
            proposals.append(region)
        if len(proposals) >= max_regions:
            break
    return _dedupe_regions(proposals, max_regions=max_regions)


def _fastsam_proposals(image_rgb: np.ndarray, *, max_regions: int = 12) -> list[SamRegion]:
    model = _load_fastsam()
    bgr = image_rgb[:, :, ::-1]
    conf = float(os.environ.get("ILP_FASTSAM_CONF", "0.25") or 0.25)
    with hold_inference("sam"):
        results = model.predict(
            source=bgr,
            conf=conf,
            iou=0.7,
            retina_masks=True,
            verbose=False,
        )
    if not results:
        return []
    result = results[0]
    masks = getattr(result, "masks", None)
    if masks is None or masks.data is None:
        return []

    h, w = image_rgb.shape[:2]
    data = masks.data.cpu().numpy()
    proposals: list[SamRegion] = []
    for i, mask in enumerate(data):
        if mask.shape[0] != h or mask.shape[1] != w:
            mask_u8 = cv2.resize(
                (mask > 0.5).astype(np.uint8) * 255,
                (w, h),
                interpolation=cv2.INTER_NEAREST,
            )
        else:
            mask_u8 = (mask > 0.5).astype(np.uint8) * 255
        box = _bbox_from_mask(mask_u8, max_w=w, max_h=h, pad=1.0)
        if not box:
            continue
        area_ratio = (box[2] * box[3]) / float(max(1, h * w))
        if area_ratio > 0.95:
            continue
        score = min(0.99, 0.35 + area_ratio * 2.0)
        region = _region_from_bbox(
            *box,
            score=score,
            label="subject" if i == 0 else "region",
            source="fastsam",
            idx=i,
        )
        if region:
            proposals.append(region)
    return _dedupe_regions(proposals, max_regions=max_regions)


def _iou(a: SamRegion, b: SamRegion) -> float:
    ax2, ay2 = a.x + a.width, a.y + a.height
    bx2, by2 = b.x + b.width, b.y + b.height
    ix1, iy1 = max(a.x, b.x), max(a.y, b.y)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = a.width * a.height + b.width * b.height - inter
    return inter / max(union, 1.0)


def _dedupe_regions(regions: list[SamRegion], *, max_regions: int) -> list[SamRegion]:
    ranked = sorted(regions, key=lambda r: r.score * r.width * r.height, reverse=True)
    kept: list[SamRegion] = []
    for region in ranked:
        if any(_iou(region, other) > 0.75 for other in kept):
            continue
        kept.append(region)
        if len(kept) >= max_regions:
            break
    return kept


def propose_sam_regions(
    image_rgb: np.ndarray,
    *,
    max_regions: int = 8,
) -> list[SamRegion]:
    """Return coarse ROI proposals (FastSAM when available, else OpenCV)."""
    if not sam_enabled():
        return []
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("image_rgb must be HxWx3")
    backend = _resolve_backend()
    if backend == "edgesam":
        try:
            from image_layer_pipeline.stages.edgesam_onnx import propose_edgesam_regions

            return propose_edgesam_regions(image_rgb, max_regions=max_regions)
        except Exception:
            return _opencv_proposals(image_rgb, max_regions=max_regions)
    if backend == "fastsam":
        try:
            return _fastsam_proposals(image_rgb, max_regions=max_regions)
        except Exception:
            return _opencv_proposals(image_rgb, max_regions=max_regions)
    if backend == "opencv":
        return _opencv_proposals(image_rgb, max_regions=max_regions)
    return []


def select_primary_region(
    regions: list[SamRegion],
    *,
    image_w: int,
    image_h: int,
) -> SamRegion | None:
    if not regions:
        return None
    frame = float(max(1, image_w * image_h))

    def rank(r: SamRegion) -> float:
        area = r.width * r.height
        if area / frame > 0.92:
            return 0.0
        return r.score * (area**0.5)

    ranked = sorted(regions, key=rank, reverse=True)
    return ranked[0] if ranked and rank(ranked[0]) > 0 else None


def crop_roi(
    image_rgb: np.ndarray,
    region: SamRegion,
    *,
    pad_ratio: float = 0.06,
) -> tuple[np.ndarray, int, int]:
    h, w = image_rgb.shape[:2]
    pad_x = max(2.0, region.width * pad_ratio)
    pad_y = max(2.0, region.height * pad_ratio)
    x0 = max(0, int(np.floor(region.x - pad_x)))
    y0 = max(0, int(np.floor(region.y - pad_y)))
    x1 = min(w, int(np.ceil(region.x + region.width + pad_x)))
    y1 = min(h, int(np.ceil(region.y + region.height + pad_y)))
    return image_rgb[y0:y1, x0:x1].copy(), x0, y0


def paste_rgba_crop(
    full_shape: tuple[int, ...],
    crop_rgba: np.ndarray,
    offset_x: int,
    offset_y: int,
) -> np.ndarray:
    h, w = full_shape[:2]
    ch, cw = crop_rgba.shape[:2]
    canvas = np.zeros((h, w, 4), dtype=np.uint8)
    y1 = min(h, offset_y + ch)
    x1 = min(w, offset_x + cw)
    canvas[offset_y:y1, offset_x:x1] = crop_rgba[: y1 - offset_y, : x1 - offset_x]
    return canvas


def paste_binary_crop(
    full_shape: tuple[int, ...],
    crop_mask: np.ndarray,
    offset_x: int,
    offset_y: int,
) -> np.ndarray:
    h, w = full_shape[:2]
    ch, cw = crop_mask.shape[:2]
    canvas = np.zeros((h, w), dtype=np.uint8)
    y1 = min(h, offset_y + ch)
    x1 = min(w, offset_x + cw)
    canvas[offset_y:y1, offset_x:x1] = crop_mask[: y1 - offset_y, : x1 - offset_x]
    return canvas


def regions_to_layer_dicts(regions: list[SamRegion], *, start_index: int = 1) -> list[dict[str, Any]]:
    layers: list[dict[str, Any]] = []
    for i, region in enumerate(regions):
        layers.append(
            {
                "type": "image",
                "x": region.x,
                "y": region.y,
                "width": max(8.0, region.width),
                "height": max(8.0, region.height),
                "name": region.label if region.label != "region" else f"区域 {start_index + i}",
            }
        )
    return layers
