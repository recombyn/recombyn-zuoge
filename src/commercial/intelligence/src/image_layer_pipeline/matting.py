"""Unified commercial matting — shared by removeBg, layer decompose, detect-regions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import numpy as np

from image_layer_pipeline.stages.matting_hints import apply_matting_hints
from image_layer_pipeline.stages.matting_router import MattingRoute, resolve_matting_route
from image_layer_pipeline.stages.segment_refined import segment_engines, segment_foreground_refined
from image_layer_pipeline.stages.subpixel_matting import trim_rgba_bbox


@dataclass
class MattingResult:
    """RGBA cutout + masks + routing metadata."""

    foreground_rgba: np.ndarray
    binary_mask: np.ndarray
    sam_regions: list[dict[str, Any]]
    route: MattingRoute
    engines: list[str]
    trim: dict[str, float]


def _has_brush_hints(
    include_mask: np.ndarray | None,
    exclude_mask: np.ndarray | None,
) -> bool:
    if include_mask is not None and np.any(include_mask):
        return True
    return exclude_mask is not None and np.any(exclude_mask)


def _build_engines(
    route: MattingRoute,
    sam_regions: list[dict[str, Any]],
    *,
    has_hints: bool,
) -> list[str]:
    engines = ["smart-matting"]
    if route.custom_onnx:
        engines.append("hr-matting")
    if route.model not in engines:
        engines.append(route.model)
    engines.extend(segment_engines(sam_regions, scene=route.scene))
    if has_hints:
        engines.append("matting-hints")
    return engines


def run_matting(
    image_rgb: np.ndarray,
    *,
    scene: str | None = "auto",
    model: str | None = None,
    decontaminate: float | None = None,
    use_sam_roi: bool | None = None,
    trim_pad: float = 2.0,
    trim_output: bool = True,
    include_mask: np.ndarray | None = None,
    exclude_mask: np.ndarray | None = None,
    custom_onnx: str | None = None,
    use_precision_onnx: bool = True,
) -> MattingResult:
    """High-precision general matting + optional keep/exclude brush hints."""
    route = resolve_matting_route(
        scene=scene,
        model=model,
        decontaminate=decontaminate,
        custom_onnx=custom_onnx,
        use_precision_onnx=use_precision_onnx,
    )
    rgba, binary, sam_regions = segment_foreground_refined(
        image_rgb,
        model_name=route.model,
        decontaminate=route.decontaminate,
        custom_onnx=route.custom_onnx,
        use_sam_roi=use_sam_roi,
    )

    has_hints = _has_brush_hints(include_mask, exclude_mask)
    if has_hints:
        rgba = apply_matting_hints(
            rgba,
            image_rgb,
            include_mask=include_mask,
            exclude_mask=exclude_mask,
            grow_similar=True,
        )
        binary = np.where(rgba[:, :, 3] > 127, 255, 0).astype(np.uint8)

    trim_meta = {
        "trimX": 0.0,
        "trimY": 0.0,
        "originWidth": float(image_rgb.shape[1]),
        "originHeight": float(image_rgb.shape[0]),
    }
    if trim_output:
        rgba, trim_meta = trim_rgba_bbox(rgba, pad=trim_pad)

    return MattingResult(
        foreground_rgba=rgba,
        binary_mask=binary,
        sam_regions=sam_regions,
        route=route,
        engines=_build_engines(route, sam_regions, has_hints=has_hints),
        trim=trim_meta,
    )


def matting_png_bytes(result: MattingResult) -> bytes:
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(result.foreground_rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
    return buf.getvalue()
