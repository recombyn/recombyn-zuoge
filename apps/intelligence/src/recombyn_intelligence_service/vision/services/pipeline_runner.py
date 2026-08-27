"""Run AI pipeline for a job — used by API thread pool."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from image_layer_pipeline.pipeline import composite_layers, load_rgb, run_pipeline
from image_layer_pipeline.stages.depth import depth_to_uint8
from image_layer_pipeline.stages.export_psd import save_png_layers, try_export_psd
from image_layer_pipeline.types import PipelineConfig
from recombyn_intelligence_service.vision.config import settings
from recombyn_intelligence_service.vision.infra.job_store import get_job, update_job


def execute_pipeline_job(job_id: str) -> None:
    job = get_job(job_id)
    if not job:
        return

    update_job(job_id, status="running", progress=5, error=None)
    try:
        cfg = PipelineConfig.from_yaml(settings.config_yaml)
        input_path = Path(job["file_path"])
        out_dir = settings.workspace / "outputs" / job_id
        out_dir.mkdir(parents=True, exist_ok=True)

        update_job(job_id, progress=15)
        image_rgb = load_rgb(input_path)
        bundle = run_pipeline(image_rgb, cfg)
        stem = input_path.stem
        update_job(job_id, progress=70)

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

        if cfg.write_psd:
            psd = try_export_psd(
                out_dir / f"{stem}_layers.psd",
                original_rgb=bundle.original_rgb,
                far_background_rgb=bundle.far_background_rgb,
                behind_subject_rgb=bundle.behind_subject_rgb,
                foreground_rgba=bundle.foreground_rgba,
                mid_mask=bundle.mid_mask,
                subject_mask=bundle.binary_mask,
                nondestructive=True,
            )
            if psd is not None:
                artifacts["psd"] = psd

        preview = composite_layers(
            bundle.far_background_rgb,
            bundle.midground_rgba,
            bundle.foreground_rgba,
        )
        preview_path = out_dir / f"{stem}_preview.png"
        Image.fromarray(preview, mode="RGB").save(preview_path)
        artifacts["preview"] = preview_path

        parallax = {
            "version": 1,
            "layers": [
                {"name": "far", "z": 0.0, "parallax_scale": 0.15},
                {"name": "mid", "z": 0.45, "parallax_scale": 0.45},
                {"name": "foreground", "z": 1.0, "parallax_scale": 1.0},
            ],
            "camera": {"fov_deg": 35, "dolly_range": 0.08, "orbit_yaw_deg": 8},
        }
        meta_path = out_dir / f"{stem}_parallax.json"
        meta_path.write_text(json.dumps(parallax, ensure_ascii=False, indent=2), encoding="utf-8")
        artifacts["parallax"] = meta_path

        file_urls = {
            k: f"/files/outputs/{job_id}/{Path(v).name}" for k, v in artifacts.items()
        }

        update_job(
            job_id,
            status="needs_review",
            progress=100,
            artifacts={k: str(v) for k, v in artifacts.items()},
            urls=file_urls,
            layers=[
                {"id": "far", "name": "远景底图", "url": file_urls.get("far_background")},
                {"id": "mid", "name": "中景", "url": file_urls.get("midground")},
                {"id": "fg", "name": "前景", "url": file_urls.get("foreground")},
                {"id": "depth", "name": "深度图", "url": file_urls.get("depth")},
            ],
            meta={"stem": stem, "size": list(image_rgb.shape[:2]), "parallax": parallax},
        )
    except Exception as exc:  # noqa: BLE001
        update_job(job_id, status="failed", error=str(exc), progress=100)
        raise
