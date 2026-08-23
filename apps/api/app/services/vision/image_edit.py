"""Image toolbar vision decompose.

editText
  - OCR only → editable text layers (font/color)
  - Background = original with text inpainted
  - Does NOT split other visual subjects

editElements
  - Subjects: SAM soft masks (primary) / rembg single-fg fallback → transparent PNG
  - Edge refine + defringe on soft alpha before encode
  - OCR text layers
  - Background = LaMa (default) or Telea inpaint of text ∪ subjects
  - Canvas places layers at source coords so the stack still reads as one picture
"""

from __future__ import annotations

import base64
import re
import tempfile
from pathlib import Path
from typing import Any, Literal

import httpx

from app.core.config import settings
from app.services.vision.crop import crop_region_to_data_url
from app.services.vision.merge_blocks import merge_text_blocks
from app.services.vision.ocr import available as ocr_available
from app.services.vision.ocr import ocr_image
from app.services.vision import lama as lama_mod
from app.services.vision import sam as sam_mod
from app.services.vision.layout import layout_or_ocr, structure_available
from app.services.vision.opencv_ops import write_temp_png

EditMode = Literal["editElements", "editText"]

_CJK_RE = re.compile(r"[\u3400-\u9fff]")


def _num(v: Any, fallback: float = 0.0) -> float:
    try:
        n = float(v)
        return n if n == n else fallback  # noqa: PLR0124 — NaN check
    except (TypeError, ValueError):
        return fallback


async def _load_bgr(image_ref: str):
    """Decode data URL or https URL → BGR ndarray."""
    import cv2
    import numpy as np

    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")

    raw: bytes
    if ref.startswith("data:"):
        # data:image/png;base64,....
        try:
            _, b64 = ref.split(",", 1)
        except ValueError as exc:
            raise ValueError("invalid data URL") from exc
        raw = base64.b64decode(b64)
    elif ref.startswith("http://") or ref.startswith("https://"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
            resp = await client.get(ref)
            if resp.status_code >= 400:
                raise ValueError(f"failed to download image ({resp.status_code})")
            raw = resp.content
    else:
        raise ValueError("image must be a data URL or https URL")

    arr = np.frombuffer(raw, dtype=np.uint8)
    bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if bgr is None:
        raise ValueError("could not decode image")
    return bgr


def _bgr_to_data_url(bgr) -> str:
    import cv2

    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("encode png failed")
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _refine_layer_alpha(bgr_crop, alpha):
    """Edge-aware soft alpha + defringe for transparent PNG layers."""
    import cv2
    import numpy as np

    a = np.asarray(alpha, dtype=np.float32)
    if a.ndim != 2 or a.shape[:2] != bgr_crop.shape[:2]:
        return None
    if float(a.max()) < 8:
        return None

    # Bilateral on alpha keeps soft hair while reducing mask noise.
    a_u8 = np.clip(a, 0, 255).astype(np.uint8)
    a_soft = cv2.bilateralFilter(a_u8, d=5, sigmaColor=48, sigmaSpace=48).astype(np.float32)

    # Narrow-band: pull RGB from solid interior to kill color spill / white fringe.
    rgb = bgr_crop.astype(np.float32)
    solid = (a_soft >= 240).astype(np.uint8)
    if solid.max() == 0:
        solid = (a_soft >= 180).astype(np.uint8)
    if solid.max() > 0:
        seed = np.zeros_like(rgb)
        known = solid.astype(bool)
        seed[known] = rgb[known]
        grown = (solid * 255).astype(np.uint8)
        filled = seed.copy()
        dil_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        for _ in range(4):
            grown_next = cv2.dilate(grown, dil_k, iterations=1)
            for c in range(3):
                ch = filled[:, :, c]
                ch_dil = cv2.dilate(ch, dil_k, iterations=1)
                newly = (grown_next > 0) & (grown == 0)
                ch[newly] = ch_dil[newly]
                filled[:, :, c] = ch
            grown = grown_next
        edge = (a_soft > 2) & (a_soft < 240)
        if edge.any():
            t = np.clip((240.0 - a_soft) / 240.0, 0.0, 1.0)
            t = np.where(edge, np.minimum(t * 1.25, 1.0), 0.0)[..., None]
            rgb = rgb * (1.0 - t) + filled * t

    a_out = np.where(a_soft < 4, 0, a_soft).astype(np.uint8)
    rgb_u8 = np.clip(rgb, 0, 255).astype(np.uint8)
    rgb_u8[a_out == 0] = 0
    rgba = cv2.cvtColor(rgb_u8, cv2.COLOR_BGR2BGRA)
    rgba[:, :, 3] = a_out
    return rgba


def _rgba_crop_data_url(bgr, region: dict[str, Any], pad: int = 2) -> str | None:
    """Crop with soft edge; keep RGB (canvas images). Prefer transparent when mask present."""
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    x = int(max(0, _num(region.get("x")) - pad))
    y = int(max(0, _num(region.get("y")) - pad))
    bw = int(max(1, _num(region.get("width"), 1) + pad * 2))
    bh = int(max(1, _num(region.get("height"), 1) + pad * 2))
    x2 = min(w, x + bw)
    y2 = min(h, y + bh)
    if x2 <= x or y2 <= y:
        return None

    crop = bgr[y:y2, x:x2].copy()
    mask = region.get("mask")
    if mask is not None:
        try:
            m = np.asarray(mask)
            if m.ndim == 2 and m.shape[0] == h and m.shape[1] == w:
                m_crop = m[y:y2, x:x2]
                rgba = _refine_layer_alpha(crop, m_crop)
                if rgba is None:
                    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
                    rgba[:, :, 3] = m_crop
                ok, buf = cv2.imencode(".png", rgba)
                if ok:
                    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
                    return f"data:image/png;base64,{b64}"
        except Exception:
            pass

    return crop_region_to_data_url(bgr, {"x": x, "y": y, "width": x2 - x, "height": y2 - y}, pad=0)


def _iou(a: dict[str, Any], b: dict[str, Any]) -> float:
    ax, ay = _num(a.get("x")), _num(a.get("y"))
    aw, ah = _num(a.get("width"), 1), _num(a.get("height"), 1)
    bx, by = _num(b.get("x")), _num(b.get("y"))
    bw, bh = _num(b.get("width"), 1), _num(b.get("height"), 1)
    ix0, iy0 = max(ax, bx), max(ay, by)
    ix1, iy1 = min(ax + aw, bx + bw), min(ay + ah, by + bh)
    iw, ih = max(0.0, ix1 - ix0), max(0.0, iy1 - iy0)
    inter = iw * ih
    if inter <= 0:
        return 0.0
    union = aw * ah + bw * bh - inter
    return inter / union if union > 0 else 0.0


def _overlaps_text(region: dict[str, Any], texts: list[dict[str, Any]], thresh: float = 0.35) -> bool:
    for t in texts:
        if _iou(region, t) >= thresh:
            return True
    return False


def _sample_ink_color(bgr, block: dict[str, Any]) -> str:
    """Pick dominant ink color inside text bbox (darkest / farthest from bg)."""
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    x = int(max(0, _num(block.get("x"))))
    y = int(max(0, _num(block.get("y"))))
    bw = int(max(1, _num(block.get("width"), 1)))
    bh = int(max(1, _num(block.get("height"), 1)))
    x2, y2 = min(w, x + bw), min(h, y + bh)
    crop = bgr[y:y2, x:x2]
    if crop.size == 0:
        return "#333333"

    # Resize for speed
    small = cv2.resize(crop, (max(8, crop.shape[1] // 2), max(8, crop.shape[0] // 2)))
    pixels = small.reshape(-1, 3).astype(np.float32)
    # Background ≈ lightest / median
    lum = pixels[:, 0] * 0.114 + pixels[:, 1] * 0.587 + pixels[:, 2] * 0.299
    bg_idx = int(np.argmax(lum))
    bg = pixels[bg_idx]
    # Ink ≈ farthest from bg among darker pixels
    dark = pixels[lum < np.percentile(lum, 45)]
    if len(dark) < 4:
        dark = pixels
    dist = np.linalg.norm(dark - bg, axis=1)
    ink = dark[int(np.argmax(dist))]
    b, g, r = [int(max(0, min(255, round(c)))) for c in ink]
    return f"#{r:02X}{g:02X}{b:02X}"


def _estimate_font(block: dict[str, Any], fill: str) -> dict[str, Any]:
    """Map OCR box → fontFamily / weight / size (catalog-friendly names)."""
    text = str(block.get("text") or "")
    h = max(1.0, _num(block.get("height"), 14))
    w = max(1.0, _num(block.get("width"), 14))
    font_size = max(10.0, round(_num(block.get("font_size"), h * 0.78), 1))
    cjk = bool(_CJK_RE.search(text))
    latin = bool(re.search(r"[A-Za-z]", text))
    # Aspect: wide chars → display; dense small → body
    chars = max(1, len(text.strip()))
    avg_char_w = w / chars
    bold = font_size >= 28 or (avg_char_w / max(font_size, 1) > 0.95 and font_size >= 18)

    if cjk and not latin:
        if bold or font_size >= 36:
            family = "Alibaba PuHuiTi Bold" if bold else "SimHei"
            weight = "bold" if bold else "normal"
            if font_size >= 48:
                family = "Alibaba PuHuiTi Bold"
                weight = "bold"
        elif font_size <= 14:
            family = "SimSun"
            weight = "normal"
        else:
            family = "Alibaba PuHuiTi"
            weight = "normal"
    elif latin and not cjk:
        family = "Arial"
        weight = "bold" if bold else "normal"
        # Serif heuristic: narrow tall glyphs often serif display
        if avg_char_w / max(font_size, 1) < 0.45 and font_size >= 20:
            family = "Georgia"
    else:
        family = "Alibaba PuHuiTi"
        weight = "bold" if bold else "normal"

    return {
        "fontSize": font_size,
        "fontFamily": family,
        "fontWeight": weight,
        "fill": fill,
        "lineHeight": 1.25,
    }


def _rembg_subject_regions(bgr, max_regions: int = 8) -> list[dict[str, Any]]:
    """Single-foreground rembg cutout — fallback when SAM has no instances."""
    import cv2
    import numpy as np

    try:
        from app.services.vision.remove_bg import cutout_rgba_from_bytes, rembg_available
    except Exception:
        return []
    if not rembg_available():
        return []

    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        return []
    raw = buf.tobytes()
    rgba = None
    for mode in ("hair", "product"):
        try:
            rgba = cutout_rgba_from_bytes(raw, mode=mode)  # type: ignore[arg-type]
            break
        except Exception:
            continue
    if rgba is None:
        return []

    arr = np.asarray(rgba)
    if arr.ndim != 3 or arr.shape[2] < 4:
        return []
    alpha = arr[:, :, 3]
    if int(alpha.max()) < 8:
        return []

    mask = (alpha >= 16).astype(np.uint8) * 255
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    h, w = mask.shape[:2]
    min_area = max(400, int(h * w * 0.02))
    max_area = int(h * w * 0.92)
    regions: list[dict[str, Any]] = []
    for i in range(1, num):
        area = int(stats[i, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        x = int(stats[i, cv2.CC_STAT_LEFT])
        y = int(stats[i, cv2.CC_STAT_TOP])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        if bw < 12 or bh < 12:
            continue
        soft = np.where(labels == i, alpha, 0).astype(np.uint8)
        regions.append(
            {
                "x": float(x),
                "y": float(y),
                "width": float(bw),
                "height": float(bh),
                "area": float(area),
                "source": "rembg",
                "layout_type": "subject",
                "name": "主体",
                "mask": soft,
            }
        )
    regions.sort(key=lambda r: r["area"], reverse=True)
    return regions[:max_regions]


def _opencv_subject_regions(bgr, texts: list[dict[str, Any]], max_regions: int = 8) -> list[dict[str, Any]]:
    """Contour-based subject proposals when rembg / SAM are unavailable."""
    import cv2
    import numpy as np

    h, w = bgr.shape[:2]
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 60, 160)
    # Suppress text areas so letter strokes don't become "subjects"
    for t in texts:
        x = int(max(0, _num(t.get("x")) - 2))
        y = int(max(0, _num(t.get("y")) - 2))
        bw = int(max(1, _num(t.get("width"), 1) + 4))
        bh = int(max(1, _num(t.get("height"), 1) + 4))
        edges[y : min(h, y + bh), x : min(w, x + bw)] = 0

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    closed = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel, iterations=2)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_area = max(400, int(h * w * 0.01))
    max_area = int(h * w * 0.85)
    regions: list[dict[str, Any]] = []
    for cnt in contours or []:
        area = float(cv2.contourArea(cnt))
        if area < min_area or area > max_area:
            continue
        x, y, bw, bh = cv2.boundingRect(cnt)
        if bw < 12 or bh < 12:
            continue
        # Skip near-full-frame
        if bw * bh > h * w * 0.9:
            continue
        regions.append(
            {
                "x": float(x),
                "y": float(y),
                "width": float(bw),
                "height": float(bh),
                "area": area,
                "source": "opencv",
                "layout_type": "subject",
            }
        )
    regions.sort(key=lambda r: r["area"], reverse=True)
    # NMS
    kept: list[dict[str, Any]] = []
    for r in regions:
        if any(_iou(r, k) > 0.55 for k in kept):
            continue
        if _overlaps_text(r, texts, 0.55):
            continue
        kept.append(r)
        if len(kept) >= max_regions:
            break
    return kept


def _union_erase_mask(h: int, w: int, regions: list[dict[str, Any]]):
    """Soft-mask union (preferred) or padded bboxes for erase / Telea."""
    import cv2
    import numpy as np

    mask = np.zeros((h, w), dtype=np.uint8)
    pad = 3
    for region in regions:
        soft = region.get("mask")
        used_soft = False
        if soft is not None:
            try:
                m = np.asarray(soft)
                if m.ndim == 2 and m.shape[0] == h and m.shape[1] == w:
                    mask = np.maximum(mask, (m > 8).astype(np.uint8) * 255)
                    used_soft = True
            except Exception:
                used_soft = False
        if used_soft:
            continue
        x = int(max(0, _num(region.get("x")) - pad))
        y = int(max(0, _num(region.get("y")) - pad))
        bw = int(max(1, _num(region.get("width"), 1) + pad * 2))
        bh = int(max(1, _num(region.get("height"), 1) + pad * 2))
        mask[y : min(h, y + bh), x : min(w, x + bw)] = 255
    if mask.max() == 0:
        return mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    return cv2.dilate(mask, kernel, iterations=1)


def _inpaint_regions(bgr, regions: list[dict[str, Any]]) -> tuple[Any, str]:
    """Remove listed regions via LaMa (default) then OpenCV Telea.

    Returns ``(bgr, engine)`` where engine is ``lama`` | ``telea`` | ``none``.
    """
    import cv2

    if not regions:
        return bgr.copy(), "none"
    h, w = bgr.shape[:2]
    mask = _union_erase_mask(h, w, regions)
    if mask.max() == 0:
        return bgr.copy(), "none"

    if settings.enable_lama and lama_mod.available():
        try:
            with tempfile.TemporaryDirectory() as tmp:
                tmp_dir = Path(tmp)
                src = tmp_dir / "src.png"
                write_temp_png(bgr, src)
                out = lama_mod.inpaint(src, regions=regions)
                if out is not None and out.is_file():
                    painted = cv2.imread(str(out))
                    if painted is not None:
                        return painted, "lama"
        except Exception:
            pass

    try:
        return cv2.inpaint(bgr, mask, 3, cv2.INPAINT_TELEA), "telea"
    except Exception:
        return bgr.copy(), "none"


def _collect_text_blocks(path: Path) -> tuple[list[dict[str, Any]], str]:
    if structure_available():
        try:
            blocks, engine = layout_or_ocr(path, page_index=0, lang=settings.ocr_lang)
            texts = [b for b in blocks if b.get("type") == "text" and str(b.get("text") or "").strip()]
            figures = [
                b
                for b in blocks
                if b.get("type") == "image"
                or str(b.get("layout_type") or "").lower() in {"figure", "image", "equation"}
            ]
            return merge_text_blocks(texts) + figures, engine
        except Exception:
            pass
    blocks = ocr_image(path, page_index=0, lang=settings.ocr_lang)
    return merge_text_blocks(blocks), "paddleocr"


def _enrich_texts(bgr, texts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for block in texts:
        if str(block.get("type") or "") != "text":
            continue
        text = str(block.get("text") or "").strip()
        if not text:
            continue
        fill = _sample_ink_color(bgr, block)
        style = _estimate_font(block, fill)
        item = {
            "type": "text",
            "text": text,
            "x": _num(block.get("x")),
            "y": _num(block.get("y")),
            "width": max(8.0, _num(block.get("width"), 40)),
            "height": max(8.0, _num(block.get("height"), 14)),
            "name": "文字",
            **style,
        }
        out.append(item)
    return out


def _collect_subjects(bgr, path: Path, texts: list[dict[str, Any]], mixed_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Subject proposals for editElements — multi-instance first:

    1. SAM automatic soft masks when ENABLE_SAM + checkpoint (primary)
    2. rembg cutout only when SAM empty (single-foreground fast path)
    3. document layout figures (PPT / posters)
    4. OpenCV edges only if still empty
    """
    subjects: list[dict[str, Any]] = []
    sam_hit = False

    # 1) SAM multi-instance soft masks (needs checkpoint; no-op when missing)
    if settings.enable_sam:
        try:
            for region in sam_mod.segment_regions(path) or []:
                item = {
                    "x": _num(region.get("x")),
                    "y": _num(region.get("y")),
                    "width": max(1.0, _num(region.get("width"), 1)),
                    "height": max(1.0, _num(region.get("height"), 1)),
                    "source": "sam",
                    "layout_type": "subject",
                    "name": "主体",
                    "area": _num(region.get("area")),
                    "score": _num(region.get("score")),
                }
                if region.get("mask") is not None:
                    item["mask"] = region["mask"]
                if _overlaps_text(item, texts, 0.55):
                    continue
                subjects.append(item)
                sam_hit = True
        except Exception:
            pass

    # 2) rembg — only when SAM did not propose instances
    if not sam_hit:
        try:
            max_r = int(getattr(settings, "sam_max_regions", 8) or 8)
            subjects.extend(_rembg_subject_regions(bgr, max_regions=max_r))
        except Exception:
            pass

    # 3) Layout figures (document / poster analysis)
    for b in mixed_blocks:
        if str(b.get("type") or "") == "text":
            continue
        layout = str(b.get("layout_type") or "").lower()
        if layout not in {"figure", "image", "equation", "sam"}:
            continue
        region = {
            "x": _num(b.get("x")),
            "y": _num(b.get("y")),
            "width": max(1.0, _num(b.get("width"), 1)),
            "height": max(1.0, _num(b.get("height"), 1)),
            "source": str(b.get("source") or "layout"),
            "layout_type": layout,
            "name": "装饰" if layout != "figure" else "主体",
        }
        if not _overlaps_text(region, texts, 0.6):
            subjects.append(region)

    # 4) OpenCV edges — last resort only
    if not subjects:
        subjects.extend(_opencv_subject_regions(bgr, texts))

    # Prefer SAM (+ soft mask) over rembg / layout / opencv when boxes overlap.
    def _rank(r: dict[str, Any]) -> tuple[float, float, float]:
        src = str(r.get("source") or "")
        pri = {"sam": 4.0, "rembg": 2.5, "layout": 1.5, "opencv": 1.0}.get(src, 1.0)
        if r.get("mask") is not None:
            pri += 0.5
        area = _num(r.get("area")) or (_num(r.get("width")) * _num(r.get("height")))
        score = _num(r.get("score"))
        return (pri, score, area)

    subjects.sort(key=_rank, reverse=True)
    kept: list[dict[str, Any]] = []
    for r in subjects:
        if _overlaps_text(r, texts, 0.55) and str(r.get("source") or "") in {"opencv", "layout"}:
            continue
        if any(_iou(r, k) > 0.5 for k in kept):
            continue
        kept.append(r)
        if len(kept) >= int(getattr(settings, "sam_max_regions", 8) or 8):
            break
    return kept


async def decompose_image(
    *,
    kind: EditMode,
    image: str,
) -> dict[str, Any]:
    """
    Split an image into canvas layers.

    Returns ``{ image, layers, kind, width, height, engines, warnings }``.
    ``image`` is the background layer.
    """
    if not ocr_available():
        raise RuntimeError(
            "OCR unavailable. Install vision extras: pip install -e '.[ocr]' "
            "(PaddleOCR + OpenCV required for 编辑文字)."
        )

    bgr = await _load_bgr(image)
    h, w = bgr.shape[:2]
    warnings: list[str] = []
    engines: list[str] = []

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "src.png"
        write_temp_png(bgr, path)
        mixed, engine = _collect_text_blocks(path)
        engines.append(engine)

        texts_raw = [b for b in mixed if str(b.get("type") or "") == "text"]
        text_layers = _enrich_texts(bgr, texts_raw)
        if text_layers:
            engines.append("text-style")

        subject_regions: list[dict[str, Any]] = []
        image_layers: list[dict[str, Any]] = []

        if kind == "editElements":
            subject_regions = _collect_subjects(bgr, path, texts_raw, mixed)
            for i, region in enumerate(subject_regions):
                src = _rgba_crop_data_url(bgr, region)
                if not src:
                    continue
                name = str(region.get("name") or f"元素 {i + 1}")
                image_layers.append(
                    {
                        "type": "image",
                        "src": src,
                        "x": _num(region.get("x")),
                        "y": _num(region.get("y")),
                        "width": max(1.0, _num(region.get("width"), 1)),
                        "height": max(1.0, _num(region.get("height"), 1)),
                        "name": name,
                    }
                )
            if image_layers:
                engines.append("subjects")
                sources = sorted(
                    {
                        str(r.get("source") or "")
                        for r in subject_regions
                        if str(r.get("source") or "")
                    }
                )
                if sources:
                    engines.append("subjects:" + "+".join(sources))
            else:
                warnings.append(
                    "未识别到可拆分主体（需 SAM_CHECKPOINT 或 rembg），仅拆出文字与背景"
                )

        # Background: inpaint text always; also subjects for editElements
        erase = list(texts_raw)
        if kind == "editElements":
            erase = erase + subject_regions
        bg_bgr, inpaint_engine = _inpaint_regions(bgr, erase)
        if erase and inpaint_engine != "none":
            engines.append(f"inpaint:{inpaint_engine}")
        bg_src = _bgr_to_data_url(bg_bgr)

    layers: list[dict[str, Any]] = [
        {
            "type": "image",
            "src": bg_src,
            "x": 0,
            "y": 0,
            "width": float(w),
            "height": float(h),
            "name": "背景",
        }
    ]
    layers.extend(image_layers)
    layers.extend(text_layers)

    if kind == "editText" and not text_layers:
        warnings.append("未识别到文字")
        # Still return background so the job doesn't look empty
        layers = [
            {
                "type": "image",
                "src": _bgr_to_data_url(bgr),
                "x": 0,
                "y": 0,
                "width": float(w),
                "height": float(h),
                "name": "原图",
            }
        ]

    return {
        "image": bg_src if kind == "editElements" or text_layers else layers[0]["src"],
        "layers": layers,
        "kind": kind,
        "width": w,
        "height": h,
        "engines": engines,
        "warnings": warnings,
    }


async def detect_regions(*, image: str) -> dict[str, Any]:
    """
    Propose subject / text boxes for the Mark tool — no inpaint, no layer crops.

    Returns ``{ image, layers, kind, width, height, engines, warnings }`` where
    ``layers`` are boxes in source-pixel coords (type image|text).
    """
    bgr = await _load_bgr(image)
    h, w = bgr.shape[:2]
    warnings: list[str] = []
    engines: list[str] = []
    layers: list[dict[str, Any]] = []
    texts_raw: list[dict[str, Any]] = []
    mixed: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory() as tmp:
        path = Path(tmp) / "src.png"
        write_temp_png(bgr, path)

        if ocr_available():
            try:
                mixed, engine = _collect_text_blocks(path)
                engines.append(engine)
                texts_raw = [b for b in mixed if str(b.get("type") or "") == "text"]
                for i, item in enumerate(_enrich_texts(bgr, texts_raw)):
                    layers.append(
                        {
                            "type": "text",
                            "text": item.get("text"),
                            "x": item["x"],
                            "y": item["y"],
                            "width": item["width"],
                            "height": item["height"],
                            "name": str(item.get("name") or f"文字 {i + 1}"),
                        }
                    )
            except Exception:
                warnings.append("文字识别失败")
        else:
            warnings.append("OCR unavailable")

        try:
            subjects = _collect_subjects(bgr, path, texts_raw, mixed)
            for i, region in enumerate(subjects):
                layers.append(
                    {
                        "type": "image",
                        "x": _num(region.get("x")),
                        "y": _num(region.get("y")),
                        "width": max(1.0, _num(region.get("width"), 1)),
                        "height": max(1.0, _num(region.get("height"), 1)),
                        "name": str(region.get("name") or f"区域 {i + 1}"),
                    }
                )
            if subjects:
                engines.append("subjects")
                sources = sorted(
                    {
                        str(r.get("source") or "")
                        for r in subjects
                        if str(r.get("source") or "")
                    }
                )
                if sources:
                    engines.append("subjects:" + "+".join(sources))
        except Exception:
            warnings.append("主体识别失败")

    if not layers:
        warnings.append("未识别到可标记区域，可手动框选")

    return {
        "image": (image or "").strip(),
        "layers": layers,
        "kind": "detectRegions",
        "width": w,
        "height": h,
        "engines": engines,
        "warnings": warnings,
    }
