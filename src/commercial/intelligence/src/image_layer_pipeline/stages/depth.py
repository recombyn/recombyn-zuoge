"""Step 1: 空间测距（Z 轴）— Depth Anything V2。"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np
from PIL import Image

from image_layer_pipeline.runtime import INFERENCE_LOCK


@lru_cache(maxsize=2)
def _load_depth_anything(model_id: str):
    import torch
    from transformers import AutoImageProcessor, AutoModelForDepthEstimation

    device = "cuda" if torch.cuda.is_available() else "cpu"
    processor = AutoImageProcessor.from_pretrained(model_id)
    model = AutoModelForDepthEstimation.from_pretrained(model_id)
    model.to(device)
    model.eval()
    return processor, model, device


def estimate_depth(
    image_rgb: np.ndarray,
    *,
    model_id: str = "depth-anything/Depth-Anything-V2-Small-hf",
    backend: str = "auto",
) -> np.ndarray:
    """
    返回 HxW float32 深度图，归一化到 [0, 1]，**越大表示越近镜头**。
    backend: auto | transformers | proxy
    """
    use = backend
    if use == "auto":
        try:
            return _estimate_depth_transformers(image_rgb, model_id=model_id)
        except Exception as exc:  # noqa: BLE001
            print(f"[depth] Depth Anything V2 不可用，回退代理深度: {exc}")
            return estimate_depth_proxy(image_rgb)

    if use == "transformers":
        return _estimate_depth_transformers(image_rgb, model_id=model_id)

    return estimate_depth_proxy(image_rgb)


def _estimate_depth_transformers(image_rgb: np.ndarray, model_id: str) -> np.ndarray:
    import torch

    processor, model, device = _load_depth_anything(model_id)
    pil = Image.fromarray(image_rgb, mode="RGB")
    inputs = processor(images=pil, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad(), INFERENCE_LOCK:
        outputs = model(**inputs)
        # 多数 Depth Anything 输出：值越大越近
        depth = outputs.predicted_depth

    depth = torch.nn.functional.interpolate(
        depth.unsqueeze(1),
        size=image_rgb.shape[:2],
        mode="bicubic",
        align_corners=False,
    ).squeeze().float().cpu().numpy()

    return _normalize_depth(depth)


def estimate_depth_proxy(image_rgb: np.ndarray) -> np.ndarray:
    """无模型时的演示代理（亮度+局部对比），仅用于流程跑通。"""
    gray = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255.0
    edges = np.abs(cv2.Laplacian(gray, cv2.CV_32F))
    edges = edges / (edges.max() + 1e-6)
    depth = 0.7 * (1.0 - gray) + 0.3 * edges
    depth = cv2.GaussianBlur(depth, (0, 0), 5)
    return _normalize_depth(depth)


def _normalize_depth(depth: np.ndarray) -> np.ndarray:
    d = depth.astype(np.float32)
    dmin, dmax = float(d.min()), float(d.max())
    if dmax - dmin < 1e-6:
        return np.zeros_like(d, dtype=np.float32)
    return (d - dmin) / (dmax - dmin)


def depth_to_uint8(depth: np.ndarray) -> np.ndarray:
    return np.clip(depth * 255.0, 0, 255).astype(np.uint8)
