"""Generate HD PNG panel URLs when a plaza submission is approved."""

from __future__ import annotations

import io
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.services.plaza.cover import list_artboard_frames
from app.services.storage import get_storage, put_bytes

_log = logging.getLogger("plaza.panel_png")

_MAX_EDGE = 2048
_MIN_IMAGE_EDGE = 40


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _image_src(node: dict[str, Any]) -> str:
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    raw = str(attrs.get("src") or "").strip()
    if raw.startswith(("http://", "https://", "data:image/")):
        return raw
    return ""


def _is_image_node(node: dict[str, Any]) -> bool:
    key = str(node.get("key") or "").strip().lower()
    if key == "image":
        return True
    return bool(_image_src(node))


def _inside_frame(node: dict[str, Any], frame: dict[str, Any]) -> bool:
    x = _num(node.get("x"))
    y = _num(node.get("y"))
    w = max(1.0, _num(node.get("width"), 1.0))
    h = max(1.0, _num(node.get("height"), 1.0))
    cx, cy = x + w / 2.0, y + h / 2.0
    fx = _num(frame.get("x"))
    fy = _num(frame.get("y"))
    fw = max(1.0, _num(frame.get("width"), 1.0))
    fh = max(1.0, _num(frame.get("height"), 1.0))
    return fx <= cx <= fx + fw and fy <= cy <= fy + fh


def _iter_nodes(document: dict[str, Any]) -> list[dict[str, Any]]:
    dsl = document.get("deltaSetLike")
    if not isinstance(dsl, dict):
        return []
    out: list[dict[str, Any]] = []
    for key, raw in dsl.items():
        if key == "ROOT" or not isinstance(raw, dict):
            continue
        node = dict(raw)
        node["id"] = str(node.get("id") or key)
        out.append(node)
    return out


def _list_sizable_images(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    images = [n for n in nodes if _is_image_node(n) and _image_src(n)]
    return [
        n
        for n in images
        if max(_num(n.get("width")), _num(n.get("height"))) >= _MIN_IMAGE_EDGE
    ]


def _largest_image(nodes: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not nodes:
        return None
    return max(nodes, key=lambda n: _num(n.get("width")) * _num(n.get("height")))


def _panel_from_frame(
    frame: dict[str, Any],
    images: list[dict[str, Any]],
    index: int,
) -> dict[str, Any] | None:
    fid = str(frame.get("id") or f"frame-{index}")
    name = str(frame.get("name") or "").strip() or f"面板 {index + 1}"
    inside = [n for n in images if _inside_frame(n, frame)]
    best = _largest_image(inside)
    if not best:
        return None
    return {
        "id": fid,
        "name": name,
        "src": _image_src(best),
        "width": int(round(_num(best.get("width")) or _num(frame.get("width")))),
        "height": int(round(_num(best.get("height")) or _num(frame.get("height")))),
    }


def _panels_from_frames(
    frames: list[dict[str, Any]],
    images: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    panels: list[dict[str, Any]] = []
    for i, frame in enumerate(frames):
        panel = _panel_from_frame(frame, images, i)
        if panel:
            panels.append(panel)
    return panels


def _panels_from_loose_images(images: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ranked = sorted(
        images,
        key=lambda n: _num(n.get("width")) * _num(n.get("height")),
        reverse=True,
    )
    panels: list[dict[str, Any]] = []
    for i, node in enumerate(ranked):
        nid = str(node.get("id") or f"image-{i}")
        panels.append(
            {
                "id": nid,
                "name": f"面板 {i + 1}",
                "src": _image_src(node),
                "width": int(round(_num(node.get("width")) or 0)),
                "height": int(round(_num(node.get("height")) or 0)),
            }
        )
    return panels


def _list_panel_candidates(document: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Prefer one panel per artboard (largest image inside).
    If the canvas has ≤1 artboard, fall back to each sizable image node.
    """
    frames = list_artboard_frames(document)
    images = _list_sizable_images(_iter_nodes(document))
    if len(frames) >= 2:
        panels = _panels_from_frames(frames, images)
        if panels:
            return panels
    return _panels_from_loose_images(images)


def _load_image_bytes(src: str) -> bytes | None:
    raw = (src or "").strip()
    if not raw:
        return None
    if raw.startswith("data:image/"):
        import base64

        try:
            _, b64 = raw.split(",", 1)
            return base64.b64decode(b64)
        except Exception:
            return None
    if not raw.startswith(("http://", "https://")):
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(60.0, connect=20.0), follow_redirects=True) as client:
            resp = client.get(raw)
            if resp.status_code >= 400:
                _log.warning("panel image fetch failed status=%s url=%s", resp.status_code, raw[:120])
                return None
            return resp.content
    except Exception:
        _log.exception("panel image fetch error url=%s", raw[:120])
        return None


def _to_png_bytes(blob: bytes, *, max_edge: int = _MAX_EDGE) -> bytes | None:
    try:
        from PIL import Image
    except Exception:
        _log.warning("Pillow unavailable — cannot convert panel to PNG")
        return None
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA")
        w, h = im.size
        edge = max(w, h)
        if edge > max_edge > 0:
            scale = max_edge / float(edge)
            im = im.resize(
                (max(1, int(round(w * scale))), max(1, int(round(h * scale)))),
                Image.Resampling.LANCZOS,
            )
        out = io.BytesIO()
        im.save(out, format="PNG", optimize=True)
        return out.getvalue()
    except Exception:
        _log.exception("panel PNG convert failed")
        return None


def _safe_key_part(value: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (value or "").strip())[:80]
    return s or "panel"


def _public_storage_url(url: str | None) -> str:
    """Prefer absolute http(s) / site path for <img src>."""
    if not url:
        return ""
    if url.startswith(("http://", "https://", "/")):
        return url
    return f"/{url.lstrip('/')}"


def _upload_one_panel(
    *,
    storage: Any,
    submission_id: str,
    panel: dict[str, Any],
    index: int,
) -> dict[str, str] | None:
    src = str(panel.get("src") or "").strip()
    blob = _load_image_bytes(src)
    if not blob:
        return None
    png = _to_png_bytes(blob)
    if not png:
        return None
    pid = _safe_key_part(str(panel.get("id") or f"p{index}"))
    key = f"plaza/{submission_id}/panels/{pid}.png"
    try:
        put_bytes(
            key,
            png,
            content_type="image/png",
            cache_control="public, max-age=31536000, immutable",
        )
        url = _public_storage_url(storage.url_for(key))
    except Exception:
        _log.exception("panel upload failed submission=%s panel=%s", submission_id, pid)
        return None
    name = str(panel.get("name") or f"面板 {index + 1}").strip()
    _log.info(
        "panel png ok submission=%s panel=%s bytes=%s host=%s",
        submission_id,
        pid,
        len(png),
        urlparse(url).netloc if url.startswith("http") else "local",
    )
    return {"id": str(panel.get("id") or pid), "name": name, "url": url, "key": key}


def generate_panel_png_urls(
    *,
    submission_id: str,
    document: dict[str, Any] | None,
) -> list[dict[str, str]]:
    """
    Build HD PNG object URLs for plaza preview rail.
    Called only on admin approve — pending submissions keep no public panel URLs.
    """
    if not isinstance(document, dict):
        return []
    sid = (submission_id or "").strip()
    if not sid:
        return []

    storage = get_storage()
    out: list[dict[str, str]] = []
    for i, panel in enumerate(_list_panel_candidates(document)):
        uploaded = _upload_one_panel(
            storage=storage,
            submission_id=sid,
            panel=panel,
            index=i,
        )
        if uploaded:
            out.append(uploaded)
    return out
