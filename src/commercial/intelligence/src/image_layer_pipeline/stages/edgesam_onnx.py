"""EdgeSAM ONNX coarse segmentation (optional encoder/decoder weights)."""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from image_layer_pipeline.runtime import INFERENCE_LOCK
from image_layer_pipeline.stages.sam_roi import SamRegion, _bbox_from_mask, _dedupe_regions, _region_from_bbox


def edgesam_available() -> bool:
    return _resolve_encoder_path() is not None and _resolve_decoder_path() is not None


def _resolve_encoder_path() -> Path | None:
    raw = str(os.environ.get("ILP_EDGESAM_ENCODER_PATH", "") or "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return p
    repo = Path(__file__).resolve().parents[3]
    candidate = repo / "models" / "edgesam_encoder.onnx"
    return candidate if candidate.is_file() else None


def _resolve_decoder_path() -> Path | None:
    raw = str(os.environ.get("ILP_EDGESAM_DECODER_PATH", "") or "").strip()
    if raw:
        p = Path(raw)
        if p.is_file():
            return p
    repo = Path(__file__).resolve().parents[3]
    candidate = repo / "models" / "edgesam_decoder.onnx"
    return candidate if candidate.is_file() else None


@lru_cache(maxsize=1)
def _encoder_session():
    import onnxruntime as ort

    return ort.InferenceSession(
        str(_resolve_encoder_path()),
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )


@lru_cache(maxsize=1)
def _decoder_session():
    import onnxruntime as ort

    return ort.InferenceSession(
        str(_resolve_decoder_path()),
        providers=["CUDAExecutionProvider", "CPUExecutionProvider"],
    )


def _prepare_image(image_rgb: np.ndarray, size: int = 1024) -> tuple[np.ndarray, tuple[int, int]]:
    h, w = image_rgb.shape[:2]
    scale = size / float(max(h, w))
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    resized = cv2.resize(image_rgb, (nw, nh), interpolation=cv2.INTER_LINEAR)
    pad = np.zeros((size, size, 3), dtype=np.uint8)
    pad[:nh, :nw] = resized
    x = pad.astype(np.float32) / 255.0
    x = np.transpose(x, (2, 0, 1))[None, ...]
    return x, (nh, nw)


def _encode(image_rgb: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
    encoder = _encoder_session()
    x, padded = _prepare_image(image_rgb)
    inp_name = encoder.get_inputs()[0].name
    with INFERENCE_LOCK:
        embedding = encoder.run(None, {inp_name: x})[0]
    return embedding, padded


def _decode_mask(
    embedding: np.ndarray,
    point_xy: tuple[float, float],
    *,
    image_hw: tuple[int, int],
    padded_wh: tuple[int, int],
) -> np.ndarray:
    decoder = _decoder_session()
    h, w = image_hw
    nh, nw = padded_wh
    feed: dict[str, np.ndarray] = {}
    for inp in decoder.get_inputs():
        name = inp.name
        low = name.lower()
        if "image_embed" in low or low == "embeddings":
            feed[name] = embedding
        elif "point_coords" in low:
            feed[name] = np.array([[[point_xy[0], point_xy[1]]]], dtype=np.float32)
        elif "point_labels" in low:
            feed[name] = np.array([[1]], dtype=np.float32)
        elif "mask_input" in low:
            feed[name] = np.zeros((1, 1, 256, 256), dtype=np.float32)
        elif "has_mask_input" in low or low == "has_mask":
            feed[name] = np.array([0], dtype=np.float32)
        elif "orig_im_size" in low or "orig_size" in low:
            feed[name] = np.array([h, w], dtype=np.float32)
    if len(feed) < 2:
        raise RuntimeError("EdgeSAM decoder ONNX inputs could not be bound — check export names")
    with INFERENCE_LOCK:
        outputs = decoder.run(None, feed)
    mask = outputs[0]
    while mask.ndim > 2:
        mask = mask[0]
    mask_u8 = (mask > 0.0).astype(np.uint8) * 255
    mask_u8 = cv2.resize(mask_u8, (nw, nh), interpolation=cv2.INTER_NEAREST)
    return cv2.resize(mask_u8, (w, h), interpolation=cv2.INTER_NEAREST)


def propose_edgesam_regions(
    image_rgb: np.ndarray,
    *,
    max_regions: int = 8,
) -> list[SamRegion]:
    if not edgesam_available():
        raise RuntimeError(
            "EdgeSAM ONNX not configured (set ILP_EDGESAM_ENCODER_PATH + ILP_EDGESAM_DECODER_PATH)"
        )
    h, w = image_rgb.shape[:2]
    embedding, padded = _encode(image_rgb)
    nh, nw = padded
    prompts = [
        (nw * 0.5, nh * 0.5, 0.95, "subject"),
        (nw * 0.28, nh * 0.35, 0.72, "region"),
        (nw * 0.72, nh * 0.35, 0.72, "region"),
        (nw * 0.5, nh * 0.72, 0.66, "region"),
    ]
    proposals: list[SamRegion] = []
    for i, (px, py, score, label) in enumerate(prompts):
        try:
            mask = _decode_mask(
                embedding,
                (px, py),
                image_hw=(h, w),
                padded_wh=padded,
            )
            box = _bbox_from_mask(mask, max_w=w, max_h=h, pad=1.0)
            if not box:
                continue
            region = _region_from_bbox(
                *box,
                score=score,
                label=label,
                source="edgesam",
                idx=i,
            )
            if region:
                proposals.append(region)
        except Exception:
            continue
    return _dedupe_regions(proposals, max_regions=max_regions)
