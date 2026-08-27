"""类型与配置 — 融合五步流水线。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import yaml


@dataclass
class PipelineConfig:
    # Step 1 — Depth Anything V2
    depth_model: str = "depth-anything/Depth-Anything-V2-Small-hf"
    depth_backend: str = "auto"  # auto | transformers | proxy

    # Step 2 — BiRefNet + scene routing
    segmentation_model: str = "birefnet-general"
    matting_scene: str = "general"

    # Step 3 — OpenCV 修边与深度切层
    dilate_px: int = 16
    mid_dilate_px: int = 12
    decontaminate_strength: float = 0.65
    feather_px: int = 2
    # 非主体区域按深度分位切中景/远景（0~1，越大越近）
    mid_far_quantile: float = 0.45

    # Step 4 — 级联 Inpainting
    inpaint_backend: str = "lama"  # lama | opencv | flux (flux: Phase 3)
    flux_enabled: bool = False
    flux_area_threshold: float = 0.35

    # Step 5 — 导出
    write_psd: bool = True
    write_png_layers: bool = True
    output_dir: str = "outputs"

    @classmethod
    def from_yaml(cls, path: str | Path) -> PipelineConfig:
        data: dict[str, Any] = {}
        p = Path(path)
        if p.exists():
            with p.open(encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}

        depth = data.get("depth", {})
        seg = data.get("segmentation", {})
        mask = data.get("mask", {})
        inp = data.get("inpainting", {})
        exp = data.get("export", {})
        out = data.get("output", {})

        routing_cfg: dict[str, Any] = {}
        routing_path = p.parent / "routing.yaml"
        if routing_path.exists():
            with routing_path.open(encoding="utf-8") as rf:
                routing_data = yaml.safe_load(rf) or {}
            routing_cfg = routing_data.get("routing", routing_data) or {}

        return cls(
            depth_model=depth.get(
                "model", "depth-anything/Depth-Anything-V2-Small-hf"
            ),
            depth_backend=depth.get("backend", "auto"),
            segmentation_model=seg.get("model", "birefnet-general"),
            matting_scene=str(seg.get("scene") or data.get("matting", {}).get("default_scene") or "general"),
            dilate_px=int(mask.get("dilate_px", 16)),
            mid_dilate_px=int(mask.get("mid_dilate_px", 12)),
            decontaminate_strength=float(mask.get("decontaminate_strength", 0.65)),
            feather_px=int(mask.get("feather_px", 2)),
            mid_far_quantile=float(mask.get("mid_far_quantile", 0.45)),
            inpaint_backend=inp.get("backend", "lama"),
            flux_enabled=bool(routing_cfg.get("flux_enabled", False)),
            flux_area_threshold=float(routing_cfg.get("flux_area_threshold", 0.35)),
            write_psd=bool(exp.get("write_psd", True)),
            write_png_layers=bool(exp.get("write_png_layers", True)),
            output_dir=out.get("dir", "outputs"),
        )


@dataclass
class LayerBundle:
    """融合流水线中间结果与最终三图层资产。"""

    original_rgb: np.ndarray
    depth_map: np.ndarray  # HxW float32 0~1，越大越近
    foreground_rgba: np.ndarray
    binary_mask: np.ndarray
    subject_repair_mask: np.ndarray
    mid_mask: np.ndarray
    far_mask: np.ndarray
    mid_repair_mask: np.ndarray
    # 第一次重绘：挖掉主体后的完整背后场景
    behind_subject_rgb: np.ndarray
    # 第二次重绘：再挖掉中景后的纯净远景底图
    far_background_rgb: np.ndarray
    # 中景修补层（带 Alpha）
    midground_rgba: np.ndarray
