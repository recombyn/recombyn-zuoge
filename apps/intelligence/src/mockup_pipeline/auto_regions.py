"""Auto-detect printable mockup regions from a product photo (no hand-painted mask)."""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class PrintableRegion:
  """One invisible paste zone on the product photo."""

  region_id: str
  subject_mask: np.ndarray  # (H, W) float01 — full subject
  printable_mask: np.ndarray  # (H, W) float01 — paste zone only
  bbox: tuple[int, int, int, int]  # x, y, w, h of printable


def alpha_mask_from_rgba_png(rgba_png: bytes) -> np.ndarray:
  """Decode matting PNG → HxW float mask from alpha (or luminance fallback)."""
  arr = np.frombuffer(rgba_png, dtype=np.uint8)
  img = cv2.imdecode(arr, cv2.IMREAD_UNCHANGED)
  if img is None:
    raise ValueError("could not decode matting png")
  if img.ndim == 2:
    return (img.astype(np.float32) / 255.0).clip(0, 1)
  if img.shape[2] >= 4:
    return (img[:, :, 3].astype(np.float32) / 255.0).clip(0, 1)
  gray = cv2.cvtColor(img[:, :, :3], cv2.COLOR_BGR2GRAY)
  return (gray.astype(np.float32) / 255.0).clip(0, 1)


def split_subject_masks(
  fg_mask: np.ndarray,
  *,
  min_area_frac: float = 0.015,
  max_regions: int = 8,
) -> list[np.ndarray]:
  """Connected components on foreground → per-subject binary masks (largest first)."""
  h, w = fg_mask.shape[:2]
  binary = (fg_mask >= 0.35).astype(np.uint8)
  # Close small holes so one product stays one blob.
  k = max(3, int(round(min(h, w) * 0.008)) | 1)
  kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
  binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

  n, labels, stats, _ = cv2.connectedComponentsWithStats(binary, connectivity=8)
  if n <= 1:
    return []

  min_area = max(64, int(h * w * float(min_area_frac)))
  scored: list[tuple[int, np.ndarray]] = []
  for i in range(1, n):
    area = int(stats[i, cv2.CC_STAT_AREA])
    if area < min_area:
      continue
    scored.append((area, (labels == i).astype(np.float32)))
  scored.sort(key=lambda t: t[0], reverse=True)
  return [m for _, m in scored[: max(1, max_regions)]]


def printable_mask_from_subject(subject_mask: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
  """
  Estimate paste zone inside a subject (invisible to end users).

  Vertical products (cans/mugs): middle label band.
  Otherwise: eroded subject interior.
  """
  h, w = subject_mask.shape[:2]
  binary = (subject_mask >= 0.35).astype(np.uint8)
  ys, xs = np.where(binary > 0)
  if ys.size < 16:
    empty = np.zeros((h, w), dtype=np.float32)
    return empty, (0, 0, 1, 1)

  x0, x1 = int(xs.min()), int(xs.max())
  y0, y1 = int(ys.min()), int(ys.max())
  bw = max(1, x1 - x0 + 1)
  bh = max(1, y1 - y0 + 1)

  # Prefer mid-body band for tall subjects (cans / bottles / mugs).
  # Inset aggressively — AABB of a cylinder is wider than the metal face.
  tall = bh / float(bw) >= 1.15
  if tall:
    band_top = y0 + int(bh * 0.20)
    band_bot = y0 + int(bh * 0.80)
    band_left = x0 + int(bw * 0.20)
    band_right = x0 + int(bw * 0.80)
    zone = np.zeros((h, w), dtype=np.uint8)
    zone[band_top:band_bot, band_left:band_right] = 1
    printable = (zone & binary).astype(np.uint8)
    # Shrink toward center so paste stays on the curved face, not the silhouette.
    erode_k = max(3, int(round(min(bw, bh) * 0.045)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_k, erode_k))
    printable = cv2.erode(printable, kernel, iterations=1).astype(np.float32)
    if float(printable.sum()) < 32:
      printable = (zone & binary).astype(np.float32)
  else:
    erode_k = max(3, int(round(min(bw, bh) * 0.08)) | 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (erode_k, erode_k))
    eroded = cv2.erode(binary, kernel, iterations=1)
    printable = eroded.astype(np.float32)
    if float(printable.sum()) < 32:
      printable = binary.astype(np.float32)

  pys, pxs = np.where(printable >= 0.35)
  if pys.size < 8:
    printable = binary.astype(np.float32)
    pys, pxs = ys, xs
  bx0, bx1 = int(pxs.min()), int(pxs.max())
  by0, by1 = int(pys.min()), int(pys.max())
  bbox = (bx0, by0, max(1, bx1 - bx0 + 1), max(1, by1 - by0 + 1))
  return printable, bbox


def detect_printable_regions(
  fg_mask: np.ndarray,
  *,
  min_area_frac: float = 0.015,
  max_regions: int = 8,
) -> list[PrintableRegion]:
  """Foreground mask → list of paste zones (never drawn in product UI)."""
  subjects = split_subject_masks(fg_mask, min_area_frac=min_area_frac, max_regions=max_regions)
  if not subjects:
    # Fallback: soft center ellipse so kit still works without matting.
    h, w = fg_mask.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    cx, cy = w * 0.5, h * 0.48
    rx, ry = w * 0.28, h * 0.36
    ellipse = (((xx - cx) / max(rx, 1)) ** 2 + ((yy - cy) / max(ry, 1)) ** 2 <= 1.0).astype(np.float32)
    subjects = [ellipse]

  regions: list[PrintableRegion] = []
  for i, subj in enumerate(subjects):
    printable, bbox = printable_mask_from_subject(subj)
    if float(printable.sum()) < 16:
      continue
    regions.append(
      PrintableRegion(
        region_id=f"r{i}",
        subject_mask=subj.astype(np.float32),
        printable_mask=printable.astype(np.float32),
        bbox=bbox,
      )
    )
  if not regions:
    h, w = fg_mask.shape[:2]
    full = np.ones((h, w), dtype=np.float32)
    regions.append(
      PrintableRegion(region_id="r0", subject_mask=full, printable_mask=full, bbox=(0, 0, w, h))
    )
  return regions
