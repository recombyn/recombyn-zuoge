"""Server-side artboard export (PNG) for async jobs (ADR 0005).

Not a full canvas-engine replay — composites artboard background, solid rects,
image nodes, and scene text (wrapped to the node box). Interactive canvas
export stays in the browser.
"""

from __future__ import annotations

import io
import json
import logging
import os
import re
from functools import lru_cache
from typing import Any

from app.services.plaza.cover import list_artboard_frames
from app.services.plaza.panel_png import _load_image_bytes, _to_png_bytes
from app.services.storage import get_storage, put_bytes

_log = logging.getLogger(__name__)

_MAX_EDGE = 4096
_MAX_FRAMES = 12


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _parse_color(raw: Any, default: tuple[int, int, int, int] = (255, 255, 255, 255)):
    s = str(raw or "").strip()
    if not s or s.lower() in ("none", "transparent"):
        return default
    if s.startswith("rgba") or s.startswith("rgb"):
        return _parse_rgb_func(s, default, alpha=s.startswith("rgba"))
    return _parse_hex_color(s, default)


def _parse_rgb_func(
    s: str,
    default: tuple[int, int, int, int],
    *,
    alpha: bool,
) -> tuple[int, int, int, int]:
    inner = s[s.find("(") + 1 : s.rfind(")")]
    parts = [p.strip() for p in inner.split(",")]
    if len(parts) < 3:
        return default
    r, g, b = (max(0, min(255, int(float(parts[i])))) for i in range(3))
    if not alpha:
        return (r, g, b, 255)
    a = 255
    if len(parts) >= 4:
        a = max(0, min(255, int(float(parts[3]) * 255)))
    return (r, g, b, a)


def _parse_hex_color(
    s: str, default: tuple[int, int, int, int]
) -> tuple[int, int, int, int]:
    hex_s = s[1:] if s.startswith("#") else s
    if len(hex_s) == 3:
        hex_s = "".join(ch * 2 for ch in hex_s)
    try:
        if len(hex_s) == 6:
            n = int(hex_s, 16)
            return ((n >> 16) & 255, (n >> 8) & 255, n & 255, 255)
        if len(hex_s) == 8:
            n = int(hex_s, 16)
            return ((n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255)
    except ValueError:
        return default
    return default


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


def _attrs(node: dict[str, Any]) -> dict[str, Any]:
    raw = node.get("attrs")
    return raw if isinstance(raw, dict) else {}


def _node_box(node: dict[str, Any]) -> tuple[float, float, float, float]:
    x = _num(node.get("x"))
    y = _num(node.get("y"))
    w = max(1.0, _num(node.get("width"), 1.0))
    h = max(1.0, _num(node.get("height"), 1.0))
    return x, y, w, h


def _inside_frame(node: dict[str, Any], frame: dict[str, Any]) -> bool:
    x, y, w, h = _node_box(node)
    cx, cy = x + w / 2.0, y + h / 2.0
    fx = _num(frame.get("x"))
    fy = _num(frame.get("y"))
    fw = max(1.0, _num(frame.get("width"), 1.0))
    fh = max(1.0, _num(frame.get("height"), 1.0))
    return fx <= cx <= fx + fw and fy <= cy <= fy + fh


def _image_src(node: dict[str, Any]) -> str:
    raw = str(_attrs(node).get("src") or "").strip()
    if raw.startswith(("http://", "https://", "data:image/")):
        return raw
    return ""


def _fill_color(node: dict[str, Any]) -> tuple[int, int, int, int] | None:
    attrs = _attrs(node)
    raw = attrs.get("fill-color")
    if raw is None:
        return None
    s = str(raw).strip().lower()
    if not s or s in ("none", "transparent"):
        return None
    return _parse_color(raw, default=(0, 0, 0, 0))


def _node_z(node: dict[str, Any]) -> int:
    return int(_num(node.get("z")))


def _json_list(raw: Any) -> list[Any]:
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return parsed if isinstance(parsed, list) else []
    return []


def _text_plain(attrs: dict[str, Any]) -> str:
    origin_lines: list[str] = []
    for block in _json_list(attrs.get("ORIGIN_DATA")):
        if not isinstance(block, dict):
            continue
        children = block.get("children")
        if not isinstance(children, list):
            continue
        origin_lines.append(
            "".join(str(c.get("text") or "") for c in children if isinstance(c, dict))
        )
    origin = "\n".join(part for part in origin_lines if part)
    if origin:
        return origin

    data_lines: list[str] = []
    for run in _json_list(attrs.get("DATA")):
        if not isinstance(run, dict):
            continue
        chars = run.get("chars")
        if not isinstance(chars, list):
            continue
        data_lines.append(
            "".join(str(item.get("char") or "") for item in chars if isinstance(item, dict))
        )
    data = "\n".join(data_lines)
    if data:
        return data

    md = attrs.get("markdown")
    if isinstance(md, str) and md.strip():
        return md.strip()
    return ""


def _first_char_config(attrs: dict[str, Any]) -> dict[str, Any]:
    for run in _json_list(attrs.get("DATA")):
        if not isinstance(run, dict):
            continue
        chars = run.get("chars")
        if not isinstance(chars, list):
            continue
        for item in chars:
            if not isinstance(item, dict):
                continue
            if str(item.get("char") or "").strip():
                cfg = item.get("config")
                return cfg if isinstance(cfg, dict) else {}
    return {}


def _origin_font_base(attrs: dict[str, Any]) -> dict[str, Any]:
    for block in _json_list(attrs.get("ORIGIN_DATA")):
        if not isinstance(block, dict):
            continue
        children = block.get("children")
        if not isinstance(children, list) or not children:
            continue
        child = children[0]
        if not isinstance(child, dict):
            continue
        base = child.get("font-base")
        return base if isinstance(base, dict) else {}
    return {}


def _text_style(attrs: dict[str, Any]) -> dict[str, Any]:
    font_size = 14.0
    fill = "#333333"
    align = "left"
    line_height = 1.4
    weight = "normal"
    cfg = _first_char_config(attrs)
    if cfg.get("SIZE") is not None:
        font_size = max(1.0, _num(cfg.get("SIZE"), 14.0))
    if cfg.get("COLOR"):
        fill = str(cfg.get("COLOR"))
    if cfg.get("ALIGN"):
        align = str(cfg.get("ALIGN")).strip().lower() or "left"
    if cfg.get("LINE_HEIGHT") is not None:
        line_height = max(0.8, _num(cfg.get("LINE_HEIGHT"), 1.4))
    if str(cfg.get("WEIGHT") or "").strip().lower() in ("bold", "700", "800", "900"):
        weight = "bold"
    base = _origin_font_base(attrs)
    if base.get("fontSize") is not None:
        font_size = max(1.0, _num(base.get("fontSize"), font_size))
    if base.get("color"):
        fill = str(base.get("color"))
    if base.get("textAlign"):
        align = str(base.get("textAlign")).strip().lower() or align
    if base.get("lineHeight") is not None:
        line_height = max(0.8, _num(base.get("lineHeight"), line_height))
    return {
        "font_size": font_size,
        "fill": fill,
        "align": align,
        "line_height": line_height,
        "weight": weight,
    }


def _font_candidates(bold: bool) -> list[str]:
    windir = os.environ.get("WINDIR") or "C:\\Windows"
    if bold:
        return [
            os.path.join(windir, "Fonts", "msyhbd.ttc"),
            os.path.join(windir, "Fonts", "arialbd.ttf"),
            "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
            "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        ]
    return [
        os.path.join(windir, "Fonts", "msyh.ttc"),
        os.path.join(windir, "Fonts", "msyh.ttf"),
        os.path.join(windir, "Fonts", "simhei.ttf"),
        os.path.join(windir, "Fonts", "arial.ttf"),
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ]


@lru_cache(maxsize=8)
def _resolve_font_path(bold: bool) -> str | None:
    for path in _font_candidates(bold):
        if path and os.path.isfile(path):
            return path
    if bold:
        return _resolve_font_path(False)
    return None


@lru_cache(maxsize=32)
def _load_font(size: int, bold: bool):
    from PIL import ImageFont

    px = max(8, int(size))
    path = _resolve_font_path(bold)
    if path:
        try:
            return ImageFont.truetype(path, px)
        except OSError:
            _log.debug("export font load failed: %s", path)
    try:
        return ImageFont.load_default(size=px)
    except TypeError:
        return ImageFont.load_default()


def _glyph_width(font: Any, text: str) -> float:
    if not text:
        return 0.0
    getlength = getattr(font, "getlength", None)
    if callable(getlength):
        try:
            return float(getlength(text))
        except (TypeError, ValueError, OSError):
            pass
    bbox = font.getbbox(text)
    return float(bbox[2] - bbox[0])


def _wrap_text(text: str, font: Any, max_width: float) -> list[str]:
    limit = max(8.0, float(max_width))
    lines: list[str] = []
    for para in text.replace("\r\n", "\n").split("\n"):
        if not para:
            lines.append("")
            continue
        current = ""
        for ch in para:
            trial = current + ch
            if _glyph_width(font, trial) <= limit or not current:
                current = trial
                continue
            lines.append(current)
            current = ch
        if current:
            lines.append(current)
    return lines or [""]


def _draw_text(
    draw: Any,
    node: dict[str, Any],
    *,
    dx: int,
    dy: int,
    dw: int,
    dh: int,
    scale: float,
) -> None:
    attrs = _attrs(node)
    plain = _text_plain(attrs)
    if not plain.strip():
        return
    style = _text_style(attrs)
    font_px = max(8, int(round(style["font_size"] * scale)))
    font = _load_font(font_px, style["weight"] == "bold")
    color = _parse_color(style["fill"], default=(51, 51, 51, 255))
    lines = _wrap_text(plain, font, max(font_px, dw))
    line_px = max(1, int(round(style["font_size"] * max(0.8, style["line_height"]) * scale)))
    auto_size = str(attrs.get("autoSize") or "true").lower() != "false"
    origin_y = dy
    if not auto_size:
        content_h = line_px * max(1, len(lines))
        origin_y = dy + max(0, (dh - content_h) // 2)
    align = style["align"]
    for i, line in enumerate(lines):
        y = origin_y + i * line_px
        if y >= dy + dh:
            break
        if align in ("center", "middle"):
            x = dx + max(0.0, (dw - _glyph_width(font, line)) / 2.0)
        elif align in ("right", "end"):
            x = dx + max(0.0, dw - _glyph_width(font, line))
        else:
            x = float(dx)
        draw.text((int(round(x)), int(y)), line or " ", font=font, fill=color[:3])


def _paint_image(canvas: Any, src: str, dx: int, dy: int, dw: int, dh: int) -> None:
    from PIL import Image

    blob = _load_image_bytes(src)
    png = _to_png_bytes(blob, max_edge=_MAX_EDGE) if blob else None
    if not png:
        return
    im = Image.open(io.BytesIO(png)).convert("RGBA")
    im = im.resize((dw, dh), Image.Resampling.LANCZOS)
    canvas.alpha_composite(im, (dx, dy))


def _paint_node(
    canvas: Any,
    draw: Any,
    node: dict[str, Any],
    *,
    dx: int,
    dy: int,
    dw: int,
    dh: int,
    scale: float,
) -> None:
    key = str(node.get("key") or "").strip().lower()
    if key == "text":
        _draw_text(draw, node, dx=dx, dy=dy, dw=dw, dh=dh, scale=scale)
        return
    src = _image_src(node)
    if src:
        _paint_image(canvas, src, dx, dy, dw, dh)
        return
    fill = _fill_color(node)
    if fill is None:
        return
    draw.rectangle([dx, dy, dx + dw, dy + dh], fill=fill)


def _fallback_frame(document: dict[str, Any]) -> dict[str, Any]:
    w = max(1.0, _num(document.get("width"), 794.0))
    h = max(1.0, _num(document.get("height"), 1123.0))
    bg = document.get("backgroundColor") or "#ffffff"
    return {
        "id": "frame_full",
        "name": "frame_full",
        "x": 0,
        "y": 0,
        "width": w,
        "height": h,
        "backgroundColor": bg,
    }


def _select_frames(document: dict[str, Any], frame_id: str | None) -> list[dict[str, Any]]:
    frames = list_artboard_frames(document)
    if not frames:
        frames = [_fallback_frame(document)]
    want = (frame_id or "").strip()
    if want:
        picked = [f for f in frames if str(f.get("id") or "") == want]
        if not picked:
            raise ValueError(f"frame not found: {want}")
        return picked[:_MAX_FRAMES]
    return frames[:_MAX_FRAMES]


def _scale_for(w: int, h: int) -> float:
    edge = max(w, h, 1)
    if edge <= _MAX_EDGE:
        return 1.0
    return _MAX_EDGE / float(edge)


def render_artboard_png(document: dict[str, Any], frame: dict[str, Any]) -> bytes:
    from PIL import Image, ImageDraw

    fw = max(1, int(round(_num(frame.get("width"), 1.0))))
    fh = max(1, int(round(_num(frame.get("height"), 1.0))))
    scale = _scale_for(fw, fh)
    cw, ch = max(1, int(round(fw * scale))), max(1, int(round(fh * scale)))
    bg = _parse_color(frame.get("backgroundColor") or document.get("backgroundColor") or "#ffffff")
    canvas = Image.new("RGBA", (cw, ch), bg)
    draw = ImageDraw.Draw(canvas)
    fx, fy = _num(frame.get("x")), _num(frame.get("y"))

    nodes = [n for n in _iter_nodes(document) if _inside_frame(n, frame)]
    nodes.sort(key=_node_z)

    for node in nodes:
        x, y, w, h = _node_box(node)
        dx = int(round((x - fx) * scale))
        dy = int(round((y - fy) * scale))
        dw = max(1, int(round(w * scale)))
        dh = max(1, int(round(h * scale)))
        _paint_node(canvas, draw, node, dx=dx, dy=dy, dw=dw, dh=dh, scale=scale)

    out = io.BytesIO()
    canvas.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


def _safe_key_part(value: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9._-]+", "-", (value or "").strip())[:80]
    return s or "export"


def render_and_store_export(
    *,
    document: dict[str, Any],
    user_id: str,
    job_id: str,
    fmt: str,
    frame_id: str | None = None,
) -> dict[str, Any]:
    """Render artboards to PNG and persist. Returns result dict for the job record."""
    if not isinstance(document, dict):
        raise ValueError("document required")
    kind = (fmt or "png").strip().lower()
    if kind != "png":
        raise ValueError("format must be png")
    frames = _select_frames(document, frame_id)
    pages = [render_artboard_png(document, frame) for frame in frames]
    if not pages:
        raise ValueError("nothing to export")

    payload = pages[0]
    ext, content_type = "png", "image/png"

    key = f"exports/{_safe_key_part(user_id)}/{_safe_key_part(job_id)}/export.{ext}"
    put_bytes(key, payload, content_type=content_type, cache_control="private, max-age=86400")
    storage = get_storage()
    url = storage.url_for(key)
    return {
        "key": key,
        "url": url,
        "contentType": content_type,
        "bytes": len(payload),
        "pages": len(pages),
        "format": kind,
    }
