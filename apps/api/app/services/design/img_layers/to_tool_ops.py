"""Map vision decompose layers → canvas tool_ops (shared apply path)."""

from __future__ import annotations

import uuid
from typing import Any


def _num(v: Any, default: float = 0.0) -> float:
    try:
        n = float(v)
        return n if n == n else default  # noqa: PLR0124
    except (TypeError, ValueError):
        return default


def _op(name: str, args: dict[str, Any]) -> dict[str, Any]:
    return {"name": name, "args": args, "op_id": f"il_{uuid.uuid4().hex[:12]}"}


def layers_to_tool_ops(
    layers: list[dict[str, Any]],
    *,
    canvas_w: int,
    canvas_h: int,
    src_w: int,
    src_h: int,
    frame_name: str = "AI Board",
    board_src: str | None = None,
) -> list[dict[str, Any]]:
    """
    Build create_frame + create_image/create_text ops.

    Layer geometry is in source-pixel space; scaled into the artboard.
    """
    fw = max(40, int(canvas_w))
    fh = max(40, int(canvas_h))
    sw = max(1, int(src_w) or fw)
    sh = max(1, int(src_h) or fh)
    sx = fw / sw
    sy = fh / sh

    ops: list[dict[str, Any]] = [
        _op(
            "create_frame",
            {
                "name": frame_name,
                "width": fw,
                "height": fh,
                "backgroundColor": "#FFFFFF",
            },
        )
    ]

    usable = [L for L in layers if isinstance(L, dict)]
    if not usable and board_src:
        usable = [
            {
                "type": "image",
                "src": board_src,
                "x": 0,
                "y": 0,
                "width": sw,
                "height": sh,
                "name": "整板",
            }
        ]

    for i, layer in enumerate(usable):
        kind = str(layer.get("type") or "").strip().lower()
        x = _num(layer.get("x")) * sx
        y = _num(layer.get("y")) * sy
        w = max(8.0, _num(layer.get("width"), sw) * sx)
        h = max(8.0, _num(layer.get("height"), sh) * sy)
        # Zero-size fallback layers (OCR missing dims) → full board.
        if _num(layer.get("width")) <= 0 or _num(layer.get("height")) <= 0:
            x, y, w, h = 0.0, 0.0, float(fw), float(fh)

        name = str(layer.get("name") or "").strip() or f"Layer {i + 1}"

        if kind == "text":
            text = str(layer.get("text") or "").strip()
            if not text:
                continue
            font_size = _num(layer.get("fontSize"), max(12.0, h * 0.75))
            # Scale font with the board.
            font_size = max(8.0, font_size * min(sx, sy))
            args: dict[str, Any] = {
                "text": text,
                "x": round(x, 2),
                "y": round(y, 2),
                "width": round(w, 2),
                "height": round(h, 2),
                "fontSize": round(font_size, 1),
                "name": name,
                "wrap": True,
            }
            fill = layer.get("fill") or layer.get("color")
            if fill is not None:
                args["fill"] = str(fill)
            if layer.get("fontFamily"):
                args["fontFamily"] = str(layer.get("fontFamily"))
            if layer.get("fontWeight") is not None:
                args["fontWeight"] = layer.get("fontWeight")
            if layer.get("lineHeight") is not None:
                args["lineHeight"] = layer.get("lineHeight")
            ops.append(_op("create_text", args))
            continue

        src = str(layer.get("src") or board_src or "").strip()
        if not src:
            continue
        ops.append(
            _op(
                "create_image",
                {
                    "src": src,
                    "x": round(x, 2),
                    "y": round(y, 2),
                    "width": round(w, 2),
                    "height": round(h, 2),
                    "name": name,
                },
            )
        )

    return ops
