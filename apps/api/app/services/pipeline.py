"""Import pipeline: image → Scene JSON."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Literal

from app.core.config import settings
from app.services.raster_fallback import page_images_as_blocks
from app.services.scene_builder import build_scene_response
from app.services.storage import upload_page_images
from app.services.vision import analyze_page_images

SourceType = Literal["image"]


def _job_pages_dir(job_id: str | None) -> Path:
    base = Path(settings.result_dir)
    if job_id:
        return base / job_id / "pages"
    return base / "_sync" / "pages"


def _rel_page_paths(paths: list[Path]) -> list[str]:
    root = Path(settings.result_dir).resolve()
    rel: list[str] = []
    for path in paths:
        try:
            rel.append(str(path.resolve().relative_to(root)).replace("\\", "/"))
        except ValueError:
            rel.append(str(path).replace("\\", "/"))
    return rel


def _is_drawable_block(block: dict) -> bool:
    """Match blocks_to_scene acceptance rules (non-drawable → empty canvas)."""
    if not isinstance(block, dict):
        return False
    btype = block.get("type")
    if btype == "text" and block.get("text"):
        return True
    if btype == "image" and block.get("src"):
        return True
    if btype in {"rect", "table"}:
        return True
    return False


def _scene_child_count(document: dict | None) -> int:
    if not isinstance(document, dict):
        return 0
    root = (document.get("deltaSetLike") or {}).get("ROOT") or {}
    kids = root.get("children")
    return len(kids) if isinstance(kids, list) else 0


def _apply_raster_fallback(
    page_images: list[Path],
    warnings: list[str],
    engines: list[str],
) -> tuple[list[dict], int, int]:
    blocks, width, height = page_images_as_blocks(
        page_images, target_w=settings.scene_target_width
    )
    if blocks:
        engines.append("raster-fallback")
        warnings.append(
            "OCR produced no text layers; imported page image(s) as canvas images. "
            "Install OCR extras for editable text: pip install -e '.[ocr]'"
        )
    return blocks, width, height


def _prepare_page_images(file_path: Path, job_id: str | None) -> list[Path]:
    pages_dir = _job_pages_dir(job_id)
    if pages_dir.exists():
        shutil.rmtree(pages_dir, ignore_errors=True)
    pages_dir.mkdir(parents=True, exist_ok=True)

    suffix = file_path.suffix.lower() or ".png"
    dest = pages_dir / f"0001{suffix}"
    shutil.copy2(file_path, dest)
    return [dest]


def run_import(source_type: SourceType, file_path: Path, job_id: str | None = None) -> dict:
    if source_type != "image":
        return {
            "job_id": job_id,
            "status": "failed",
            "document": None,
            "error": "Only image import is supported.",
            "meta": {
                "source_type": source_type,
                "page_count": 0,
                "page_images": [],
                "object_keys": [],
                "object_urls": [],
                "palette": [],
                "engines": [],
                "warnings": [],
            },
        }

    warnings: list[str] = []
    page_images: list[Path] = []
    engines: list[str] = []
    palette: list[str] = []
    width = settings.scene_target_width
    height = 1123

    try:
        page_images = _prepare_page_images(file_path, job_id)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"preprocess failed: {exc}")

    blocks: list[dict] = []

    if settings.use_vision and page_images:
        vision = analyze_page_images(page_images)
        warnings.extend(vision.get("warnings") or [])
        engines.extend(vision.get("engines") or [])
        palette = vision.get("palette") or []
        width = int(vision.get("width") or width)
        height = int(vision.get("height") or height)
        blocks = vision.get("blocks") or []

    drawable = [b for b in blocks if _is_drawable_block(b)]
    if blocks and not drawable and page_images:
        warnings.append("vision blocks had no drawable layers; using page raster fallback")
        blocks, width, height = _apply_raster_fallback(page_images, warnings, engines)
    elif not drawable and page_images:
        blocks, width, height = _apply_raster_fallback(page_images, warnings, engines)
    else:
        blocks = drawable

    page_rels, object_keys, object_urls = ([], [], [])
    if page_images:
        try:
            page_rels, object_keys, object_urls = upload_page_images(job_id, page_images)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"storage upload failed: {exc}")
            page_rels = _rel_page_paths(page_images)

    meta = {
        "source_type": source_type,
        "page_count": max(len(page_images), 1) if page_images else 0,
        "page_images": page_rels or _rel_page_paths(page_images),
        "object_keys": object_keys,
        "object_urls": object_urls,
        "palette": palette,
        "engines": engines,
        "warnings": warnings,
    }

    if not blocks:
        err = (
            (warnings[-1] if warnings else None)
            or "No content extracted from file."
        )
        return {
            "job_id": job_id,
            "status": "failed",
            "document": None,
            "error": err,
            "meta": meta,
        }

    document = build_scene_response(blocks, width=width, height=height)

    if _scene_child_count(document) == 0 and page_images:
        blocks, width, height = _apply_raster_fallback(page_images, warnings, engines)
        if blocks:
            document = build_scene_response(blocks, width=width, height=height)
            meta["engines"] = engines
            meta["warnings"] = warnings

    if _scene_child_count(document) == 0:
        return {
            "job_id": job_id,
            "status": "failed",
            "document": None,
            "error": "Import produced an empty canvas.",
            "meta": meta,
        }

    return {
        "job_id": job_id,
        "status": "done",
        "document": document,
        "meta": meta,
    }
