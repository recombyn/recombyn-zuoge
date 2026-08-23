"""融合流水线编排 — 主体分层（BiRefNet + 亚像素 + OpenCV 背景修补）。"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from image_layer_pipeline.subject_pipeline import run_subject_layer_pipeline
from image_layer_pipeline.stages.export_psd import export_psd, save_png_layers
from image_layer_pipeline.stages.depth import depth_to_uint8
from image_layer_pipeline.types import LayerBundle, PipelineConfig


def load_rgb(path: str | Path) -> np.ndarray:
    img = Image.open(path).convert("RGB")
    return np.asarray(img, dtype=np.uint8)


def run_pipeline(
    image_rgb: np.ndarray,
    config: PipelineConfig | None = None,
) -> LayerBundle:
    return run_subject_layer_pipeline(image_rgb, config)


def process_file(
    input_path: str | Path,
    output_dir: str | Path | None = None,
    config: PipelineConfig | None = None,
) -> dict[str, Path]:
    cfg = config or PipelineConfig()
    input_path = Path(input_path)
    out_dir = Path(output_dir or cfg.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    image_rgb = load_rgb(input_path)
    bundle = run_pipeline(image_rgb, cfg)
    stem = input_path.stem
    results: dict[str, Path] = {}

    if cfg.write_png_layers:
        results.update(
            save_png_layers(
                out_dir,
                stem,
                foreground_rgba=bundle.foreground_rgba,
                midground_rgba=bundle.midground_rgba,
                far_background_rgb=bundle.far_background_rgb,
                behind_subject_rgb=bundle.behind_subject_rgb,
                binary_mask=bundle.binary_mask,
                mid_mask=bundle.mid_mask,
                far_mask=bundle.far_mask,
                depth_u8=depth_to_uint8(bundle.depth_map),
                subject_repair_mask=bundle.subject_repair_mask,
            )
        )

    if cfg.write_psd:
        psd_path = out_dir / f"{stem}_layers.psd"
        try:
            export_psd(
                psd_path,
                original_rgb=bundle.original_rgb,
                far_background_rgb=bundle.far_background_rgb,
                behind_subject_rgb=bundle.behind_subject_rgb,
                foreground_rgba=bundle.foreground_rgba,
                mid_mask=bundle.mid_mask,
                subject_mask=bundle.binary_mask,
                nondestructive=True,
            )
            results["psd"] = psd_path
        except Exception as exc:  # noqa: BLE001
            print(f"[export] PSD 写出失败（PNG 图层仍可用）: {exc}")

    preview = composite_layers(
        bundle.far_background_rgb,
        bundle.midground_rgba,
        bundle.foreground_rgba,
    )
    preview_path = out_dir / f"{stem}_preview.png"
    Image.fromarray(preview, mode="RGB").save(preview_path)
    results["preview"] = preview_path
    return results


def composite_layers(
    far_rgb: np.ndarray,
    mid_rgba: np.ndarray,
    fg_rgba: np.ndarray,
) -> np.ndarray:
    """远景 ← 中景 ← 前景 顺序合成预览。"""
    out = far_rgb.astype(np.float32)
    for layer in (mid_rgba, fg_rgba):
        rgb = layer[:, :, :3].astype(np.float32)
        a = layer[:, :, 3:4].astype(np.float32) / 255.0
        out = rgb * a + out * (1.0 - a)
    return np.clip(out, 0, 255).astype(np.uint8)


# 兼容旧 UI 引用
_composite = composite_layers
