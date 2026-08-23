"""Build full-page image blocks when OCR / layout extraction is empty."""

from __future__ import annotations

import base64
import mimetypes
from pathlib import Path


def file_to_data_url(path: Path) -> str:
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    b64 = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _image_size(path: Path) -> tuple[int, int]:
    try:
        from PIL import Image

        with Image.open(path) as im:
            return int(im.width), int(im.height)
    except Exception:
        pass
    try:
        import cv2

        img = cv2.imread(str(path))
        if img is not None:
            h, w = img.shape[:2]
            return int(w), int(h)
    except Exception:
        pass
    return 794, 1123


def page_images_as_blocks(
    page_images: list[Path],
    target_w: int = 794,
) -> tuple[list[dict], int, int]:
    """
    One full-bleed image layer per page (stacked vertically).
    Used when vision/OCR produces no editable blocks.
    """
    if not page_images:
        return [], target_w, int(target_w * 1.414)

    blocks: list[dict] = []
    y_off = 0.0
    first_w = target_w
    for index, path in enumerate(page_images):
        iw, ih = _image_size(path)
        scale = target_w / float(iw) if iw > 0 else 1.0
        tw = float(target_w)
        th = max(1.0, float(ih) * scale)
        if index == 0:
            first_w = int(tw)
        blocks.append(
            {
                "type": "image",
                "page": index,
                "x": 0.0,
                "y": y_off,
                "width": tw,
                "height": th,
                "src": file_to_data_url(path),
                "source": "raster-fallback",
                "layout_type": "page",
            }
        )
        y_off += th

    return blocks, first_w, max(1, int(round(y_off)))
