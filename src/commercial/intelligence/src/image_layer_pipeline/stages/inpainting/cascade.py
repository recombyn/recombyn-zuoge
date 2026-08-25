"""Step 4: 级联 Inpainting（LaMa 优先，OpenCV 回退）。"""

from __future__ import annotations

from functools import lru_cache

import cv2
import numpy as np
from PIL import Image

from image_layer_pipeline.runtime import hold_inference


@lru_cache(maxsize=1)
def _lama():
    from simple_lama_inpainting import SimpleLama

    return SimpleLama()


def inpaint_once(
    image_rgb: np.ndarray,
    repair_mask: np.ndarray,
    backend: str = "lama",
) -> np.ndarray:
    mask = repair_mask
    if mask.ndim == 3:
        mask = mask[:, :, 0]
    mask_u8 = (mask > 127).astype(np.uint8) * 255

    if backend == "flux":
        try:
            from image_layer_pipeline.stages.inpainting.flux import flux_available, inpaint_flux

            if flux_available():
                return inpaint_flux(image_rgb, mask_u8)
        except Exception as exc:  # noqa: BLE001
            print(f"[inpainting] Flux 不可用，回退 LaMa: {exc}")

    if backend in {"lama", "flux"}:
        try:
            return _inpaint_lama(image_rgb, mask_u8)
        except Exception as exc:  # noqa: BLE001
            print(f"[inpainting] LaMa 不可用，回退 OpenCV: {exc}")
            return _inpaint_opencv(image_rgb, mask_u8)
    return _inpaint_opencv(image_rgb, mask_u8)


def cascade_inpaint(
    image_rgb: np.ndarray,
    subject_repair_mask: np.ndarray,
    mid_repair_mask: np.ndarray,
    backend: str = "lama",
) -> tuple[np.ndarray, np.ndarray]:
    """
    级联重绘：
      1) 挖掉前景主体 → 脑补中景+远景（behind_subject）
      2) 再挖掉中景 → 纯净远景底图（far_background）
    """
    behind_subject = inpaint_once(image_rgb, subject_repair_mask, backend=backend)

    # 第二次：在已补全图上继续挖中景（并入主体洞，避免缝隙）
    combined = np.maximum(subject_repair_mask, mid_repair_mask)
    far_background = inpaint_once(behind_subject, combined, backend=backend)
    return behind_subject, far_background


def _inpaint_lama(image_rgb: np.ndarray, mask_u8: np.ndarray) -> np.ndarray:
    lama = _lama()
    image = Image.fromarray(image_rgb)
    mask = Image.fromarray(mask_u8)
    with hold_inference("lama"):
        result = lama(image, mask)
    if isinstance(result, Image.Image):
        arr = np.asarray(result.convert("RGB"), dtype=np.uint8)
    else:
        arr = np.asarray(result, dtype=np.uint8)
        if arr.ndim == 3 and arr.shape[2] == 4:
            arr = arr[:, :, :3]
    return arr


def _inpaint_opencv(image_rgb: np.ndarray, mask_u8: np.ndarray) -> np.ndarray:
    return cv2.inpaint(image_rgb, mask_u8, inpaintRadius=5, flags=cv2.INPAINT_TELEA)
