"""Gradio Web UI — 融合五步分层流水线。"""

from __future__ import annotations

from pathlib import Path

import gradio as gr
import numpy as np
from PIL import Image

from image_layer_pipeline.stages.depth import depth_to_uint8
from image_layer_pipeline.stages.export_psd import save_png_layers, try_export_psd
from image_layer_pipeline.pipeline import composite_layers, run_pipeline
from image_layer_pipeline.types import PipelineConfig

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CFG = ROOT / "configs" / "default.yaml"


def _np_rgb(image: Image.Image | np.ndarray | None) -> np.ndarray | None:
    if image is None:
        return None
    if isinstance(image, np.ndarray):
        if image.ndim == 2:
            image = np.stack([image] * 3, axis=-1)
        if image.shape[2] == 4:
            image = image[:, :, :3]
        return image.astype(np.uint8)
    return np.asarray(image.convert("RGB"), dtype=np.uint8)


def process_ui(
    image: Image.Image | None,
    model: str,
    depth_backend: str,
    dilate_px: int,
    mid_quantile: float,
    decontaminate: float,
    backend: str,
    export_psd_flag: bool,
) -> tuple:
    if image is None:
        raise gr.Error("请先上传图片")

    cfg = PipelineConfig.from_yaml(DEFAULT_CFG)
    cfg.segmentation_model = model
    cfg.depth_backend = depth_backend
    cfg.dilate_px = int(dilate_px)
    cfg.mid_far_quantile = float(mid_quantile)
    cfg.decontaminate_strength = float(decontaminate)
    cfg.inpaint_backend = backend
    cfg.write_psd = bool(export_psd_flag)

    out_dir = ROOT / "outputs"
    out_dir.mkdir(parents=True, exist_ok=True)

    rgb = _np_rgb(image)
    assert rgb is not None
    bundle = run_pipeline(rgb, cfg)
    stem = "upload"

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

    preview = composite_layers(
        bundle.far_background_rgb,
        bundle.midground_rgba,
        bundle.foreground_rgba,
    )
    Image.fromarray(preview, mode="RGB").save(out_dir / f"{stem}_preview.png")

    psd_msg = "（未导出）"
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
        psd_msg = str(psd) if psd is not None else "（PSD 跳过）"

    return (
        Image.fromarray(depth_to_uint8(bundle.depth_map), mode="L"),
        Image.fromarray(bundle.foreground_rgba, mode="RGBA"),
        Image.fromarray(bundle.midground_rgba, mode="RGBA"),
        Image.fromarray(bundle.far_background_rgb, mode="RGB"),
        Image.fromarray(preview, mode="RGB"),
        psd_msg,
    )


def build_app() -> gr.Blocks:
    models = [
        "birefnet-general",
        "birefnet-general-lite",
        "u2net",
        "isnet-general-use",
        "u2net_human_seg",
    ]

    with gr.Blocks(title="图片分层流水线") as demo:
        gr.Markdown(
            """
            # 图片分层流水线（融合方案）
            **Depth Anything V2 → BiRefNet → OpenCV 切层 → 级联 LaMa → 三图层 PSD**
            """
        )
        with gr.Row():
            with gr.Column(scale=1):
                inp = gr.Image(type="pil", label="输入图像", height=320)
                model = gr.Dropdown(models, value="birefnet-general", label="抠图模型")
                depth_backend = gr.Radio(
                    ["auto", "transformers", "proxy"],
                    value="auto",
                    label="深度后端（auto 优先 Depth Anything V2）",
                )
                dilate = gr.Slider(0, 40, value=16, step=1, label="主体 Mask 膨胀")
                mid_q = gr.Slider(
                    0.1, 0.9, value=0.45, step=0.05, label="中/远景深度分位"
                )
                decont = gr.Slider(0, 1, value=0.65, step=0.05, label="去污染强度")
                backend = gr.Radio(["lama", "opencv"], value="lama", label="Inpainting")
                do_psd = gr.Checkbox(True, label="导出三图层 PSD")
                btn = gr.Button("开始分层", variant="primary")
            with gr.Column(scale=2):
                with gr.Tab("深度图"):
                    out_depth = gr.Image(type="pil", label="Depth (近=亮)")
                with gr.Tab("前景"):
                    out_fg = gr.Image(type="pil", label="Foreground", format="png")
                with gr.Tab("中景"):
                    out_mid = gr.Image(type="pil", label="Midground", format="png")
                with gr.Tab("远景底图"):
                    out_far = gr.Image(type="pil", label="Far Background")
                with gr.Tab("合成预览"):
                    out_preview = gr.Image(type="pil", label="Preview")
                psd_path = gr.Textbox(label="PSD 路径", interactive=False)

        btn.click(
            process_ui,
            inputs=[inp, model, depth_backend, dilate, mid_q, decont, backend, do_psd],
            outputs=[out_depth, out_fg, out_mid, out_far, out_preview, psd_path],
        )
    return demo


def main() -> None:
    demo = build_app()
    demo.launch(server_name="127.0.0.1", server_port=7860)


if __name__ == "__main__":
    main()
