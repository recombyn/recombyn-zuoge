"""HTTP client for the closed-source Image Layer Pipeline microservice."""

from __future__ import annotations

import asyncio
import base64
import re
import time
from typing import Any

import httpx

from app.core.config import settings

_TERMINAL = frozenset({"needs_review", "done", "failed", "cancelled"})
_DATA_URL_RE = re.compile(r"^data:([^;,]+)?(?:;base64)?,(.+)$", re.DOTALL)


def ilp_enabled() -> bool:
    return bool(_base_url())


def _base_url() -> str:
    explicit = str(getattr(settings, "image_layer_pipeline_url", "") or "").strip().rstrip("/")
    if explicit:
        return explicit
    mode = str(getattr(settings, "intelligence_provider", "") or "").strip().lower()
    intel_url = str(getattr(settings, "intelligence_remote_url", "") or "").strip().rstrip("/")
    if intel_url and mode in {"remote", "cloud"}:
        return intel_url
    return ""


def _headers() -> dict[str, str]:
    key = str(getattr(settings, "image_layer_pipeline_api_key", "") or "").strip()
    if not key:
        key = str(getattr(settings, "intelligence_remote_api_key", "") or "").strip()
    if not key:
        return {}
    return {"Authorization": f"Bearer {key}"}


def _timeout() -> httpx.Timeout:
    sec = float(getattr(settings, "image_layer_pipeline_timeout_sec", 300.0) or 300.0)
    return httpx.Timeout(sec, connect=min(30.0, sec))


async def _load_bytes(image_ref: str) -> tuple[bytes, str]:
    ref = (image_ref or "").strip()
    if not ref:
        raise ValueError("image is required")

    if ref.startswith("data:"):
        match = _DATA_URL_RE.match(ref)
        if not match:
            raise ValueError("invalid data URL")
        b64 = match.group(2)
        return base64.b64decode(b64), "upload.png"

    if ref.startswith("http://") or ref.startswith("https://"):
        async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=20.0)) as client:
            resp = await client.get(ref)
            if resp.status_code >= 400:
                raise ValueError(f"failed to download image ({resp.status_code})")
            name = "upload.png"
            if "png" in (resp.headers.get("content-type") or ""):
                name = "upload.png"
            elif "jpeg" in (resp.headers.get("content-type") or "") or "jpg" in (
                resp.headers.get("content-type") or ""
            ):
                name = "upload.jpg"
            return resp.content, name

    raise ValueError("image must be a data URL or https URL")


async def create_job(image_ref: str) -> str:
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/jobs",
            files={"file": (filename, content, "application/octet-stream")},
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP create job failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        job_id = str(data.get("job_id") or "").strip()
        if not job_id:
            raise RuntimeError("ILP create job returned no job_id")
        return job_id


async def wait_for_job(job_id: str) -> dict[str, Any]:
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    interval = float(getattr(settings, "image_layer_pipeline_poll_sec", 1.0) or 1.0)
    deadline = time.monotonic() + float(
        getattr(settings, "image_layer_pipeline_timeout_sec", 300.0) or 300.0
    )
    async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0)) as client:
        while time.monotonic() < deadline:
            resp = await client.get(
                f"{base}/api/v1/pipeline/jobs/{job_id}",
                headers=_headers(),
            )
            if resp.status_code >= 400:
                raise RuntimeError(f"ILP job poll failed ({resp.status_code}): {resp.text[:300]}")
            job = resp.json()
            status = str(job.get("status") or "")
            if status in _TERMINAL:
                return job
            await asyncio.sleep(max(0.25, interval))
    raise TimeoutError(f"ILP job {job_id} timed out")


async def segment_foreground_via_ilp(
    image_ref: str,
    *,
    model: str = "birefnet-general",
    decontaminate: float = 0.65,
) -> tuple[bytes, str]:
    """Matting-only — BiRefNet + decontaminate on the intelligence service."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/segment",
            files={"file": (filename, content, "application/octet-stream")},
            data={
                "model": model.strip() or "birefnet-general",
                "decontaminate": str(max(0.0, min(1.0, float(decontaminate)))),
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP segment failed ({resp.status_code}): {resp.text[:300]}")
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        return resp.content, ctype


async def text_decompose_via_ilp(
    image_ref: str,
    *,
    lang: str = "ch",
    min_confidence: float = 0.72,
) -> dict[str, Any]:
    """editText OCR + inpaint on intelligence."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/text-decompose",
            files={"file": (filename, content, "application/octet-stream")},
            data={
                "lang": lang.strip() or "ch",
                "min_confidence": str(max(0.0, min(1.0, float(min_confidence)))),
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP text-decompose failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        if not isinstance(data, dict):
            raise RuntimeError("ILP text-decompose returned invalid JSON")
        return data


async def upscale_via_ilp(
    image_ref: str,
    *,
    resolution: str = "4K",
    target_long_edge: int | None = None,
) -> tuple[bytes, str]:
    """Real-ESRGAN super-resolution on intelligence."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    data: dict[str, str] = {"resolution": (resolution or "4K").strip() or "4K"}
    if target_long_edge is not None and int(target_long_edge) > 0:
        data["target_long_edge"] = str(int(target_long_edge))
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/upscale",
            files={"file": (filename, content, "application/octet-stream")},
            data=data,
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP upscale failed ({resp.status_code}): {resp.text[:300]}")
        engine = (resp.headers.get("x-ilp-engine") or "realesrgan").strip()
        return resp.content, engine


async def detect_regions_via_ilp(
    image_ref: str,
    *,
    lang: str = "ch",
    model: str = "birefnet-general",
) -> dict[str, Any]:
    """Mark tool — OCR text boxes + foreground bbox on intelligence."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/detect-regions",
            files={"file": (filename, content, "application/octet-stream")},
            data={
                "lang": lang.strip() or "ch",
                "model": model.strip() or "birefnet-general",
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP detect-regions failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        if not isinstance(data, dict):
            raise RuntimeError("ILP detect-regions returned invalid JSON")
        return data


async def erase_alpha_via_ilp(image_ref: str, mask_bytes: bytes) -> bytes:
    """Smart eraser — expand brush mask and punch alpha on intelligence."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    content, filename = await _load_bytes(image_ref)
    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/erase-alpha",
            files={
                "file": (filename, content, "application/octet-stream"),
                "mask": ("mask.png", mask_bytes, "image/png"),
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP erase-alpha failed ({resp.status_code}): {resp.text[:300]}")
        return resp.content


async def inpaint_image_via_ilp(
    image_bytes: bytes,
    mask_bytes: bytes,
    *,
    backend: str = "lama",
) -> bytes:
    """Stateless LaMa inpaint on intelligence — for editText background erase."""
    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.post(
            f"{base}/api/v1/pipeline/inpaint",
            files={
                "file": ("image.png", image_bytes, "image/png"),
                "mask": ("mask.png", mask_bytes, "image/png"),
            },
            data={"backend": backend.strip() or "lama"},
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP inpaint failed ({resp.status_code}): {resp.text[:300]}")
        return resp.content


def analyze_pages_via_ilp(
    page_paths: list,
    *,
    lang: str = "ch",
    target_width: int = 794,
    palette_k: int = 5,
    expand_table_cells: bool = True,
) -> dict[str, Any]:
    """Document import — OCR/layout on intelligence (sync)."""
    from pathlib import Path

    base = _base_url()
    if not base:
        raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )

    files: list[tuple[str, tuple[str, bytes, str]]] = []
    for idx, path in enumerate(page_paths):
        p = Path(path)
        raw = p.read_bytes()
        suffix = p.suffix.lower() or ".png"
        ctype = "image/png" if suffix == ".png" else "application/octet-stream"
        files.append(("files", (f"page_{idx:04d}{suffix}", raw, ctype)))

    with httpx.Client(timeout=_timeout()) as client:
        resp = client.post(
            f"{base}/api/v1/pipeline/analyze-pages",
            files=files,
            data={
                "lang": lang.strip() or "ch",
                "target_width": str(int(target_width)),
                "palette_k": str(int(palette_k)),
                "expand_table_cells": "true" if expand_table_cells else "false",
            },
            headers=_headers(),
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP analyze-pages failed ({resp.status_code}): {resp.text[:300]}")
        data = resp.json()
        if not isinstance(data, dict):
            raise RuntimeError("ILP analyze-pages returned invalid JSON")
        return data


async def fetch_file_bytes(relative_or_absolute_url: str) -> tuple[bytes, str]:
    base = _base_url()
    url = (relative_or_absolute_url or "").strip()
    if not url:
        raise ValueError("empty url")
    if url.startswith("/"):
        if not base:
            raise RuntimeError(
            "Depth layering service is not configured (set RECOMBYN_INTELLIGENCE_URL or IMAGE_LAYER_PIPELINE_URL)"
        )
        url = f"{base}{url}"

    async with httpx.AsyncClient(timeout=_timeout()) as client:
        resp = await client.get(url, headers=_headers())
        if resp.status_code >= 400:
            raise RuntimeError(f"ILP file fetch failed ({resp.status_code})")
        ctype = (resp.headers.get("content-type") or "image/png").split(";")[0].strip()
        return resp.content, ctype


def bytes_to_data_url(content: bytes, content_type: str = "image/png") -> str:
    b64 = base64.b64encode(content).decode("ascii")
    ctype = content_type if content_type.startswith("image/") else "image/png"
    return f"data:{ctype};base64,{b64}"
