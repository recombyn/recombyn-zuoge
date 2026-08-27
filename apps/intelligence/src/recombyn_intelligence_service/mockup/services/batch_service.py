"""Batch and async mockup rendering."""

from __future__ import annotations

import base64
import io
from typing import Any

from PIL import Image

from mockup_pipeline.batch import BatchRenderItem, render_batch
from recombyn_intelligence_service.mockup.config import settings
from recombyn_intelligence_service.mockup.infra.job_store import get_job, update_job


def execute_batch_job(job_id: str) -> None:
  job = get_job(job_id)
  if not job:
    return
  update_job(job_id, status="running")
  payload = job.get("payload") or {}
  raw_items = payload.get("items") or []
  items: list[BatchRenderItem] = []
  for idx, raw in enumerate(raw_items):
    b64 = str(raw.get("design_b64") or "")
    items.append(
      BatchRenderItem(
        design_bytes=base64.b64decode(b64),
        template_id=str(raw.get("template_id") or "demo-cylinder"),
        name=str(raw.get("name") or f"item-{idx}"),
      )
    )
  result = render_batch(items, templates_dir=settings.templates_dir)
  encoded = []
  for row in result.items:
    encoded.append(
      {
        "index": row["index"],
        "name": row["name"],
        "template_id": row["template_id"],
        "width": row["width"],
        "height": row["height"],
        "elapsed_ms": row["elapsed_ms"],
        "image_b64": base64.b64encode(row["png_bytes"]).decode("ascii"),
      }
    )
  update_job(
    job_id,
    status="done",
    result={
      "items": encoded,
      "total_ms": round(result.total_ms, 2),
      "qps": round(result.qps, 2),
      "engine": "mockup:2.5d-pbr-batch",
    },
  )


def submit_batch(items: list[dict[str, Any]]) -> str:
  from recombyn_intelligence_service.mockup.infra.job_executor import submit_mockup_job
  from recombyn_intelligence_service.mockup.infra.job_store import create_job

  job_id = create_job(kind="batch_render", payload={"items": items})
  submit_mockup_job(job_id)
  return job_id


def render_batch_sync(designs: list[bytes], template_ids: list[str]) -> dict[str, Any]:
  items = [
    BatchRenderItem(design_bytes=b, template_id=tid)
    for b, tid in zip(designs, template_ids, strict=False)
  ]
  result = render_batch(items, templates_dir=settings.templates_dir)
  out = []
  for row in result.items:
    out.append(
      {
        "index": row["index"],
        "template_id": row["template_id"],
        "width": row["width"],
        "height": row["height"],
        "elapsed_ms": row["elapsed_ms"],
        "image_b64": base64.b64encode(row["png_bytes"]).decode("ascii"),
      }
    )
  return {
    "items": out,
    "total_ms": round(result.total_ms, 2),
    "qps": round(result.qps, 2),
    "engine": "mockup:2.5d-pbr-batch",
  }
