"""KMeans color clustering for page palette."""

from __future__ import annotations


def extract_palette(img_bgr, k: int = 5) -> list[str]:
    """Return up to k dominant colors as #RRGGBB (sorted by frequency)."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return []

    if img_bgr is None or img_bgr.size == 0:
        return []

    # Downsample for speed
    small = cv2.resize(img_bgr, (0, 0), fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    data = small.reshape((-1, 3)).astype(np.float32)
    if data.shape[0] < k:
        k = max(1, data.shape[0])

    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
    _compactness, labels, centers = cv2.kmeans(data, k, None, criteria, 3, cv2.KMEANS_PP_CENTERS)
    centers = np.clip(centers, 0, 255).astype(np.uint8)
    counts = np.bincount(labels.flatten(), minlength=k)
    order = np.argsort(-counts)

    colors: list[str] = []
    for idx in order:
        b, g, r = centers[idx]
        colors.append(f"#{int(r):02X}{int(g):02X}{int(b):02X}")
    return colors
