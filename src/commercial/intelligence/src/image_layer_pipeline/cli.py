"""CLI 入口。"""

from __future__ import annotations

from pathlib import Path

import typer
from rich import print

from image_layer_pipeline.pipeline import process_file
from image_layer_pipeline.types import PipelineConfig

app = typer.Typer(add_completion=False, no_args_is_help=True)


@app.command()
def run(
    input_path: Path = typer.Argument(..., exists=True, readable=True, help="输入图片路径"),
    output: Path = typer.Option(Path("outputs"), "--output", "-o", help="输出目录"),
    config: Path = typer.Option(
        Path("configs/default.yaml"), "--config", "-c", help="YAML 配置"
    ),
    model: str | None = typer.Option(None, "--model", "-m", help="覆盖抠图模型"),
    depth_backend: str | None = typer.Option(
        None, "--depth-backend", help="auto | transformers | proxy"
    ),
    backend: str | None = typer.Option(None, "--backend", help="lama 或 opencv"),
    no_psd: bool = typer.Option(False, "--no-psd", help="不导出 PSD"),
) -> None:
    """运行融合五步图片分层流水线。"""
    cfg = PipelineConfig.from_yaml(config)
    if model:
        cfg.segmentation_model = model
    if depth_backend:
        cfg.depth_backend = depth_backend
    if backend:
        cfg.inpaint_backend = backend
    if no_psd:
        cfg.write_psd = False
    cfg.output_dir = str(output)

    print(f"[bold]输入[/bold]: {input_path}")
    print(
        f"[bold]流水线[/bold]: depth={cfg.depth_backend} → "
        f"{cfg.segmentation_model} → cascade-{cfg.inpaint_backend} → PSD"
    )
    results = process_file(input_path, output_dir=output, config=cfg)
    print("[green]完成[/green]，输出文件：")
    for key, path in results.items():
        print(f"  • {key}: {path}")


if __name__ == "__main__":
    app()
