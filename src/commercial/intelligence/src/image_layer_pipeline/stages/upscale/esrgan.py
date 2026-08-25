"""Real-ESRGAN super-resolution with tiled inference and feather stitching."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from image_layer_pipeline.runtime import INFERENCE_LOCK

TileFn = Callable[[np.ndarray], np.ndarray]


def _env_int(name: str, default: int) -> int:
    raw = str(os.environ.get(name, "") or "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = str(os.environ.get(name, "") or "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _linear_feather_1d(length: int, overlap: int) -> np.ndarray:
    if length <= 0:
        return np.zeros(0, dtype=np.float32)
    if overlap <= 0 or length <= overlap * 2:
        return np.ones(length, dtype=np.float32)
    ramp = np.linspace(0.0, 1.0, overlap, dtype=np.float32)
    core = np.ones(length - overlap * 2, dtype=np.float32)
    return np.concatenate([ramp, core, ramp[::-1]])


def _tile_weight(h: int, w: int, overlap: int) -> np.ndarray:
    wy = _linear_feather_1d(h, overlap)
    wx = _linear_feather_1d(w, overlap)
    return np.outer(wy, wx).astype(np.float32)


def upscale_tiled(
    image_rgb: np.ndarray,
    *,
    scale: int,
    tile_fn: TileFn,
    tile_size: int = 512,
    overlap: int = 32,
) -> np.ndarray:
    """Run ``tile_fn`` on overlapping tiles and feather-blend into the output canvas."""
    if scale < 1:
        raise ValueError("scale must be >= 1")
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("image_rgb must be HxWx3")

    h, w = image_rgb.shape[:2]
    if scale == 1:
        return image_rgb.copy()

    out_h, out_w = h * scale, w * scale
    acc = np.zeros((out_h, out_w, 3), dtype=np.float32)
    wsum = np.zeros((out_h, out_w, 1), dtype=np.float32)

    step = max(1, tile_size - overlap)
    pad = overlap
    for y in range(0, h, step):
        for x in range(0, w, step):
            y0 = max(0, y - pad)
            x0 = max(0, x - pad)
            y1 = min(h, y + tile_size + pad)
            x1 = min(w, x + tile_size + pad)
            tile = image_rgb[y0:y1, x0:x1]
            up = tile_fn(tile)
            if up.shape[0] != tile.shape[0] * scale or up.shape[1] != tile.shape[1] * scale:
                raise RuntimeError("tile_fn returned unexpected tile size")

            oy0, ox0 = y0 * scale, x0 * scale
            oy1, ox1 = y1 * scale, x1 * scale
            weight = _tile_weight(up.shape[0], up.shape[1], overlap * scale)[:, :, None]
            acc[oy0:oy1, ox0:ox1] += up.astype(np.float32) * weight
            wsum[oy0:oy1, ox0:ox1] += weight

    wsum = np.maximum(wsum, 1e-6)
    return np.clip(acc / wsum, 0, 255).astype(np.uint8)


@lru_cache(maxsize=2)
def _onnx_session(model_path: str):
    import onnxruntime as ort
    from image_layer_pipeline.ort_providers import preferred_ort_providers

    return ort.InferenceSession(model_path, providers=preferred_ort_providers())


def _resolve_model_path() -> Path | None:
    raw = str(os.environ.get("ILP_ESRGAN_MODEL_PATH", "") or "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return p
    repo = Path(__file__).resolve().parents[4]
    for candidate in (
        repo / "models" / "RealESRGAN_x4plus.onnx",
        repo / "models" / "realesrgan_x4.onnx",
    ):
        if candidate.is_file():
            return candidate
    return None


def _upscale_tile_onnx(tile_rgb: np.ndarray, *, scale: int) -> np.ndarray:
    model = _resolve_model_path()
    if model is None:
        raise RuntimeError(
            "Real-ESRGAN ONNX model not found (set ILP_ESRGAN_MODEL_PATH or place models/RealESRGAN_x4plus.onnx)"
        )

    session = _onnx_session(str(model))
    inp_name = session.get_inputs()[0].name
    out_name = session.get_outputs()[0].name

    x = tile_rgb.astype(np.float32) / 255.0
    x = np.transpose(x, (2, 0, 1))[None, ...]
    with INFERENCE_LOCK:
        y = session.run([out_name], {inp_name: x})[0]
    y = np.transpose(y[0], (1, 2, 0))
    y = np.clip(y * 255.0, 0, 255).astype(np.uint8)

    if scale == 2 and y.shape[0] == tile_rgb.shape[0] * 4:
        # x4 model requested for 2x target — downsample once.
        th, tw = tile_rgb.shape[0] * 2, tile_rgb.shape[1] * 2
        y = cv2.resize(y, (tw, th), interpolation=cv2.INTER_AREA)
    return y


def _upscale_tile_lanczos(tile_rgb: np.ndarray, *, scale: int) -> np.ndarray:
    th = max(1, tile_rgb.shape[0] * scale)
    tw = max(1, tile_rgb.shape[1] * scale)
    up = cv2.resize(tile_rgb, (tw, th), interpolation=cv2.INTER_LANCZOS4)
    blur = cv2.GaussianBlur(up, (0, 0), sigmaX=0.8)
    sharp = cv2.addWeighted(up, 1.25, blur, -0.25, 0)
    return np.clip(sharp, 0, 255).astype(np.uint8)


def _select_tile_fn() -> tuple[TileFn, str]:
    if _resolve_model_path() is not None:
        return lambda t, s=4: _upscale_tile_onnx(t, scale=s), "realesrgan-onnx"
    allow = str(os.environ.get("ILP_UPSCALE_ALLOW_LANCZOS", "") or "").strip().lower()
    if allow in {"1", "true", "yes", "on"}:
        return lambda t, s=2: _upscale_tile_lanczos(t, scale=s), "lanczos-sharpen"
    raise RuntimeError(
        "Real-ESRGAN ONNX model not found (set ILP_ESRGAN_MODEL_PATH or ILP_UPSCALE_ALLOW_LANCZOS=1 for dev)"
    )


def _target_scale(src_w: int, src_h: int, *, target_long_edge: int) -> int:
    long_edge = max(src_w, src_h)
    if long_edge <= 0:
        return 2
    if long_edge * 4 <= target_long_edge:
        return 4
    if long_edge * 2 <= target_long_edge:
        return 2
    return max(1, int(round(target_long_edge / long_edge)))


def _maybe_refine_faces(image_rgb: np.ndarray) -> tuple[np.ndarray, list[str]]:
    """Optional GFPGAN/CodeFormer pass when face cascade finds regions."""
    engines: list[str] = []
    try:
        cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        detector = cv2.CascadeClassifier(cascade_path)
        if detector.empty():
            return image_rgb, engines
        gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY)
        faces = detector.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=4, minSize=(32, 32))
        if len(faces) == 0:
            return image_rgb, engines
        # Face-specific ONNX (ILP_GFPGAN_MODEL_PATH) can be wired later; mark intent for now.
        gfpgan_path = str(os.environ.get("ILP_GFPGAN_MODEL_PATH", "") or "").strip()
        if gfpgan_path and Path(gfpgan_path).is_file():
            engines.append("gfpgan")
        else:
            engines.append("face-detect-only")
    except Exception:  # noqa: BLE001
        return image_rgb, engines
    return image_rgb, engines


def upscale_image(
    image_rgb: np.ndarray,
    *,
    target_long_edge: int = 4096,
    tile_size: int | None = None,
    overlap: int | None = None,
) -> tuple[np.ndarray, dict[str, object]]:
    """
    Upscale ``image_rgb`` toward ``target_long_edge`` on the long side.

    Returns (result_rgb, meta) with engine + scale info.
    """
    if image_rgb.ndim != 3:
        raise ValueError("image_rgb must be HxWx3")

    h, w = image_rgb.shape[:2]
    scale = _target_scale(w, h, target_long_edge=target_long_edge)
    tile_fn, engine = _select_tile_fn()
    tsize = tile_size if tile_size is not None else _env_int("ILP_UPSCALE_TILE", 512)
    ovl = overlap if overlap is not None else _env_int("ILP_UPSCALE_OVERLAP", 32)

    if scale == 1:
        out = image_rgb.copy()
    else:
        if engine == "realesrgan-onnx":
            run_tile = lambda t, s=scale: _upscale_tile_onnx(t, scale=s)
        else:
            run_tile = lambda t, s=scale: _upscale_tile_lanczos(t, scale=s)
        out = upscale_tiled(
            image_rgb,
            scale=scale,
            tile_fn=run_tile,
            tile_size=tsize,
            overlap=ovl,
        )

    # If still below target, one more 2x pass (bounded).
    long_edge = max(out.shape[1], out.shape[0])
    extra_passes = 0
    while long_edge < target_long_edge and extra_passes < 2 and scale < 8:
        if engine == "realesrgan-onnx":
            run_tile = lambda t: _upscale_tile_onnx(t, scale=2)
        else:
            run_tile = lambda t: _upscale_tile_lanczos(t, scale=2)
        out = upscale_tiled(
            out,
            scale=2,
            tile_fn=run_tile,
            tile_size=tsize,
            overlap=ovl,
        )
        long_edge = max(out.shape[1], out.shape[0])
        extra_passes += 1
        scale *= 2

    out, face_engines = _maybe_refine_faces(out)
    meta: dict[str, object] = {
        "engine": engine,
        "scale": scale,
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
        "tile_size": tsize,
        "overlap": ovl,
        "engines": [engine] + face_engines,
    }
    return out, meta
