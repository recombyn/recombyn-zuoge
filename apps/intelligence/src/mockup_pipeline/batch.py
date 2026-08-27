"""High-throughput batch mockup rendering."""

from __future__ import annotations

import io
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from PIL import Image

from mockup_pipeline.loader import load_template
from mockup_pipeline.renderer import IndustrialMockupRenderer


@dataclass
class BatchRenderItem:
  design_bytes: bytes
  template_id: str = "demo-cylinder"
  name: str = ""


@dataclass
class BatchRenderResult:
  items: list[dict[str, Any]] = field(default_factory=list)
  total_ms: float = 0.0
  qps: float = 0.0


def render_batch(
  items: list[BatchRenderItem],
  *,
  templates_dir: Path | None = None,
  renderer: IndustrialMockupRenderer | None = None,
) -> BatchRenderResult:
  """Sequential batch render (CPU-bound; scale horizontally via Celery workers)."""
  engine = renderer or IndustrialMockupRenderer()
  cache: dict[str, Any] = {}
  out_items: list[dict[str, Any]] = []
  t0 = time.perf_counter()

  for idx, item in enumerate(items):
    tid = item.template_id.strip() or "demo-cylinder"
    if tid not in cache:
      cache[tid] = load_template(tid, templates_dir)
    template = cache[tid]
    design = Image.open(io.BytesIO(item.design_bytes))
    layers = engine.render_layers(template, design)
    png = engine.render_png_bytes(template, design)
    out_items.append(
      {
        "index": idx,
        "name": item.name or f"item-{idx}",
        "template_id": tid,
        "width": template.width,
        "height": template.height,
        "elapsed_ms": round(layers.elapsed_ms, 2),
        "png_bytes": png,
      }
    )

  total_ms = (time.perf_counter() - t0) * 1000.0
  qps = len(items) / max(total_ms / 1000.0, 1e-6)
  return BatchRenderResult(items=out_items, total_ms=total_ms, qps=qps)
