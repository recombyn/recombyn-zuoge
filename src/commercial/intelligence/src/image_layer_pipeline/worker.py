"""AI 自动化执行器：跑流水线并写出非破坏性 PSD + 视差元数据。"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from image_layer_pipeline.depth import depth_to_uint8
from image_layer_pipeline.export_psd import export_psd, save_png_layers
from image_layer_pipeline.jobs import JobStatus, JobStore
from image_layer_pipeline.pipeline import composite_layers, load_rgb, run_pipeline
from image_layer_pipeline.types import PipelineConfig


def run_job(
    job_id: str,
    store: JobStore,
    config: PipelineConfig | None = None,
) -> None:
    job = store.get(job_id)
    if not job:
        return

    store.update_status(job_id, JobStatus.running)
    cfg = config or PipelineConfig()
    cfg.output_dir = job.output_dir
    cfg.write_psd = True
    cfg.write_png_layers = True

    try:
        input_path = Path(job.input_path)
        out_dir = Path(job.output_dir) / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        image_rgb = load_rgb(input_path)
        bundle = run_pipeline(image_rgb, cfg)
        stem = input_path.stem

        artifacts = save_png_layers(
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

        psd_path = out_dir / f"{stem}_layers.psd"
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
        artifacts["psd"] = psd_path

        preview = composite_layers(
            bundle.far_background_rgb,
            bundle.midground_rgba,
            bundle.foreground_rgba,
        )
        preview_path = out_dir / f"{stem}_preview.png"
        Image.fromarray(preview, mode="RGB").save(preview_path)
        artifacts["preview"] = preview_path

        # 2.5D 视差预设参数（AE / Web / Blender 可读）
        parallax = {
            "version": 1,
            "depth_convention": "larger_means_nearer",
            "layers": [
                {"name": "far", "z": 0.0, "parallax_scale": 0.15},
                {"name": "mid", "z": 0.45, "parallax_scale": 0.45},
                {"name": "foreground", "z": 1.0, "parallax_scale": 1.0},
            ],
            "camera": {
                "fov_deg": 35,
                "dolly_range": 0.08,
                "orbit_yaw_deg": 8,
                "orbit_pitch_deg": 3,
            },
        }
        meta_path = out_dir / f"{stem}_parallax.json"
        meta_path.write_text(
            json.dumps(parallax, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        artifacts["parallax"] = meta_path

        store.update_status(
            job_id,
            JobStatus.needs_review,
            artifacts={k: str(v) for k, v in artifacts.items()},
            meta={"stem": stem, "size": list(image_rgb.shape[:2])},
        )
    except Exception as exc:  # noqa: BLE001
        store.update_status(job_id, JobStatus.failed, error=str(exc))
        raise
