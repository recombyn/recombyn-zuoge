"""监听 inbox 文件夹，自动创建分层任务。"""

from __future__ import annotations

import time
from pathlib import Path

from image_layer_pipeline.jobs import JobStore
from image_layer_pipeline.queueing import enqueue, get_store, init_runtime
from image_layer_pipeline.types import PipelineConfig

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}


def watch_inbox(
    workspace: Path,
    *,
    poll_seconds: float = 2.0,
    config: PipelineConfig | None = None,
) -> None:
    workspace = Path(workspace)
    inbox = workspace / "inbox"
    processing = workspace / "processing"
    outputs = workspace / "outputs"
    for d in (inbox, processing, outputs):
        d.mkdir(parents=True, exist_ok=True)

    store = init_runtime(workspace, config)
    seen: set[str] = set()
    print(f"[watcher] 监听 {inbox.resolve()} …")

    while True:
        for path in sorted(inbox.iterdir()):
            if not path.is_file():
                continue
            if path.suffix.lower() not in IMAGE_EXTS:
                continue
            key = str(path.resolve())
            if key in seen:
                continue
            # 等待写入完成
            size1 = path.stat().st_size
            time.sleep(0.4)
            if not path.exists() or path.stat().st_size != size1:
                continue

            dest = processing / path.name
            path.replace(dest)
            job = store.create(str(dest), str(outputs), meta={"source": "watcher"})
            enqueue(job.id)
            seen.add(str(dest.resolve()))
            print(f"[watcher] 已入队 {job.id}: {dest.name}")
        time.sleep(poll_seconds)


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    cfg = PipelineConfig.from_yaml(root / "configs" / "default.yaml")
    watch_inbox(root / "workspace", config=cfg)


if __name__ == "__main__":
    main()
