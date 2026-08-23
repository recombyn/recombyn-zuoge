"""Multi create_frame batches keep plates; single create_frame is host-owned."""

from __future__ import annotations

from app.services.design.runtime.graph.paint_kit import (
    _cap_create_frame_ops,
    _count_create_frame_ops,
    _is_multi_artboard_batch,
    _paint_ops_for_host,
    _strip_create_frame_ops,
)


def _frame(name: str, w: int = 390, h: int = 844) -> dict:
    return {
        "name": "create_frame",
        "args": {"name": name, "width": w, "height": h, "x": 0, "y": 0},
    }


def _shape(label: str) -> dict:
    return {
        "name": "create_shape",
        "args": {"shapeType": "rect", "x": 0, "y": 0, "width": 100, "height": 40, "name": label},
    }


def test_count_and_multi_detect() -> None:
    ops = [_frame("Login"), _shape("a"), _frame("Home"), _shape("b")]
    assert _count_create_frame_ops(ops) == 2
    assert _is_multi_artboard_batch(ops) is True
    assert _is_multi_artboard_batch([_frame("Only")]) is False


def test_host_keeps_create_frame_when_multi() -> None:
    ops = [_frame("Login"), _shape("a"), _frame("Home"), _shape("b")]
    out = _paint_ops_for_host(ops)
    names = [o["name"] for o in out]
    assert names.count("create_frame") == 2
    assert names == ["create_frame", "create_shape", "create_frame", "create_shape"]


def test_host_strips_single_create_frame() -> None:
    ops = [_frame("Poster"), _shape("hero")]
    out = _paint_ops_for_host(ops)
    assert all(o["name"] != "create_frame" for o in out)
    assert out == _strip_create_frame_ops(ops)


def test_cap_create_frames() -> None:
    ops = [_frame(f"F{i}") for i in range(10)] + [_shape("tail")]
    capped = _cap_create_frame_ops(ops, limit=8)
    assert _count_create_frame_ops(capped) == 8
    assert capped[-1]["name"] == "create_shape"
    painted = _paint_ops_for_host(ops)
    assert _count_create_frame_ops(painted) == 8
    assert painted[-1]["name"] == "create_shape"