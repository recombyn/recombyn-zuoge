"""Segmentation session loading — rembg + optional custom ONNX (ben_custom)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from image_layer_pipeline.runtime import INFERENCE_LOCK

import numpy as np
from PIL import Image
from rembg import new_session, remove


@lru_cache(maxsize=8)
def _session(model_key: str, custom_onnx: str = ""):
    if model_key == "ben_custom":
        if not custom_onnx:
            raise ValueError("ben_custom requires custom ONNX path")
        return new_session("ben_custom", model_path=custom_onnx)
    return new_session(model_key)


@lru_cache(maxsize=4)
def _onnx_matting_session(onnx_path: str):
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.enable_cpu_mem_arena = False
    opts.enable_mem_pattern = False
    providers = ort.get_available_providers()
    preferred = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider") if p in providers]
    return ort.InferenceSession(
        onnx_path,
        sess_options=opts,
        providers=preferred or None,
    )


def _onnx_input_size(onnx_path: str) -> tuple[int, int]:
    sess = _onnx_matting_session(onnx_path)
    shape = sess.get_inputs()[0].shape
    if len(shape) >= 4 and shape[2] and shape[3]:
        return int(shape[3]), int(shape[2])
    name = Path(onnx_path).name.lower()
    if "hr-matting" in name or "hr-general" in name:
        return 2048, 2048
    return 1024, 1024


def _segment_custom_onnx(pil: Image.Image, onnx_path: str) -> Image.Image:
    sess = _onnx_matting_session(onnx_path)
    size = _onnx_input_size(onnx_path)
    im = pil.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    im_ary = np.array(im, dtype=np.float32)
    im_ary = im_ary / max(float(np.max(im_ary)), 1e-6)
    tmp = np.zeros((im_ary.shape[0], im_ary.shape[1], 3), dtype=np.float32)
    for c in range(3):
        tmp[:, :, c] = (im_ary[:, :, c] - 0.5) / 1.0
    tensor = np.expand_dims(tmp.transpose((2, 0, 1)), 0).astype(np.float32)
    input_name = sess.get_inputs()[0].name
    pred = sess.run(None, {input_name: tensor})[0][:, 0, :, :]
    ma = float(np.max(pred))
    mi = float(np.min(pred))
    pred = (pred - mi) / max(ma - mi, 1e-6)
    mask = Image.fromarray((np.squeeze(pred) * 255).astype(np.uint8), mode="L")
    mask = mask.resize(pil.size, Image.Resampling.LANCZOS)
    rgba = pil.convert("RGBA")
    rgba.putalpha(mask)
    return rgba


def _is_onnx_oom(exc: BaseException) -> bool:
    msg = str(exc).lower()
    if "allocation" in msg or "allocate" in msg:
        return True
    return exc.__class__.__name__ in {"Fail", "RuntimeException"}


def _segment_rembg(pil: Image.Image, model_name: str, onnx_path: str = "") -> Image.Image:
    session = _session(model_name, onnx_path)
    rgba = remove(pil, session=session)
    if not isinstance(rgba, Image.Image):
        rgba = Image.fromarray(np.asarray(rgba))
    return rgba.convert("RGBA")


def segment_foreground(
    image_rgb: np.ndarray,
    model_name: str = "birefnet-general",
    *,
    custom_onnx: str | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Return foreground RGBA and binary mask.

    ``custom_onnx`` is used when ``model_name == ben_custom`` (fine-tuned BiRefNet ONNX).
    """
    if image_rgb.ndim != 3 or image_rgb.shape[2] != 3:
        raise ValueError("image_rgb must be HxWx3")

    pil = Image.fromarray(image_rgb, mode="RGB")
    onnx_path = str(custom_onnx or "").strip()

    with INFERENCE_LOCK:
        if model_name == "ben_custom" and onnx_path:
            try:
                rgba = _segment_custom_onnx(pil, onnx_path)
            except Exception as exc:  # noqa: BLE001
                if not _is_onnx_oom(exc):
                    raise
                _onnx_matting_session.cache_clear()
                rgba = _segment_rembg(pil, "birefnet-general")
        else:
            rgba = _segment_rembg(pil, model_name, onnx_path)

    fg = np.asarray(rgba, dtype=np.uint8)
    alpha = fg[:, :, 3]
    binary = np.where(alpha > 127, 255, 0).astype(np.uint8)
    return fg, binary
