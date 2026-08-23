"""OpenCV page preprocess helpers."""

from __future__ import annotations

from pathlib import Path


def load_bgr(path: Path):
    import cv2

    img = cv2.imread(str(path))
    if img is None:
        raise ValueError(f"Failed to read image: {path}")
    return img


def preprocess_bgr(img):
    """Light denoise + contrast boost for OCR/layout."""
    import cv2

    denoise = cv2.fastNlMeansDenoisingColored(img, None, 3, 3, 7, 21)
    lab = cv2.cvtColor(denoise, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    merged = cv2.merge((l2, a, b))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def write_temp_png(img, dest: Path) -> Path:
    import cv2

    dest.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(dest), img)
    return dest
