"""Disk cache for matting RGBA results (content-hash keyed)."""

from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path

import numpy as np

from image_layer_pipeline.stages.matting_router import MattingRoute


def matting_cache_enabled() -> bool:
    raw = str(os.environ.get("ILP_MATTING_CACHE") or "1").strip().lower()
    return raw not in {"0", "false", "no", "off"}


def matting_cache_dir() -> Path:
    explicit = str(os.environ.get("ILP_MATTING_CACHE_DIR") or "").strip()
    if explicit:
        path = Path(explicit)
    else:
        try:
            from recombyn_intelligence_service.vision.config import settings

            path = Path(settings.workspace) / "cache" / "matting"
        except Exception:
            path = Path(tempfile.gettempdir()) / "recombyn-matting-cache"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _digest_array(arr: np.ndarray | None) -> bytes:
    if arr is None:
        return b"none"
    cont = np.ascontiguousarray(arr)
    h = hashlib.sha256()
    h.update(str(cont.shape).encode("ascii"))
    h.update(str(cont.dtype).encode("ascii"))
    h.update(cont.tobytes())
    return h.digest()


def cache_key(
    image_rgb: np.ndarray,
    route: MattingRoute,
    *,
    use_sam_roi: bool | None,
    include_mask: np.ndarray | None,
    exclude_mask: np.ndarray | None,
) -> str:
    h = hashlib.sha256()
    h.update(_digest_array(image_rgb))
    h.update(str(route.scene).encode())
    h.update(str(route.model).encode())
    h.update(f"{route.decontaminate:.4f}".encode())
    h.update(str(route.custom_onnx or "").encode())
    h.update(str(use_sam_roi).encode())
    h.update(_digest_array(include_mask))
    h.update(_digest_array(exclude_mask))
    return h.hexdigest()


def load_rgba(key: str) -> tuple[np.ndarray, np.ndarray] | None:
    if not matting_cache_enabled() or not key:
        return None
    path = matting_cache_dir() / f"{key}.npz"
    if not path.is_file():
        return None
    try:
        data = np.load(path)
        rgba = data["rgba"]
        binary = data["binary"]
        if rgba.ndim != 3 or rgba.shape[2] != 4:
            return None
        return rgba, binary
    except Exception:
        return None


def store_rgba(key: str, rgba: np.ndarray, binary: np.ndarray) -> None:
    if not matting_cache_enabled() or not key:
        return
    path = matting_cache_dir() / f"{key}.npz"
    tmp = path.with_suffix(".tmp.npz")
    try:
        np.savez_compressed(
            tmp,
            rgba=np.ascontiguousarray(rgba),
            binary=np.ascontiguousarray(binary),
        )
        tmp.replace(path)
    except Exception:
        try:
            if tmp.is_file():
                tmp.unlink()
        except Exception:
            pass
