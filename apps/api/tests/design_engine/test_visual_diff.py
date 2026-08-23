"""P28 — Visual Diff: geometry always; pixel only when both screenshots decode."""
from __future__ import annotations

import base64
import copy
import io
import json
from pathlib import Path

from app.services.design.runtime.decision_log import DesignRunDecision
from app.services.design.runtime.graph.nodes.observe import (
    build_scene_visual_snapshot,
    record_visual_diff,
)
from app.services.design.runtime.graph.nodes.review import attach_judge
from app.services.design.runtime.graph.state import (
    AgentRunState,
    AgentRuntime,
    compute_visual_diff,
)

_FIX = Path(__file__).resolve().parent / "fixtures"
_FRAME = 1080 * 1920


def _load_poster() -> dict:
    return json.loads((_FIX / "poster_base.json").read_text(encoding="utf-8"))


def _with_hero(scene: dict, w: int, h: int) -> dict:
    out = copy.deepcopy(scene)
    for node in out["nodes"]:
        if node.get("id") == "hero":
            node["w"] = w
            node["h"] = h
            break
    return out


def _png_data(color: tuple[int, int, int]) -> str:
    from PIL import Image

    img = Image.new("RGB", (16, 16), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _rt(*, nodes: list | None = None, frames: list | None = None) -> AgentRuntime:
    run = AgentRunState(trace_id="tr", task_id="task_vdiff", goal="poster")
    return AgentRuntime(
        user_id="u",
        mode="agent",
        prompt="p",
        rules={},
        user_selected_model="auto",
        canvas_id=None,
        canvas_size="1080x1920",
        scene_key="poster",
        scene_nodes=list(nodes or []),
        scene_frames=list(frames or []),
        focus_id="frame_poster",
        images=[],
        memory_in={},
        session_id="s",
        project_id="p",
        hold=0,
        free_daily=False,
        t0=0.0,
        settle_hold_fn=None,
        refund_hold_fn=None,
        apply_ops=[],
        w=1080,
        h=1920,
        run=run,
        decision=DesignRunDecision(),
        flags={},
    )


def test_poster_base_snapshot_reports_geometry():
    scene = _load_poster()
    snap = build_scene_visual_snapshot(
        nodes=list(scene["nodes"]),
        frames=list(scene["frames"]),
        focus_frame_id="frame_poster",
    )
    assert snap["node_count"] == 3
    assert snap["hero_coverage"] is not None
    assert 0.35 < float(snap["hero_coverage"]) < 0.42
    assert snap["bbox_coverage"] is not None
    assert snap["text_area"] is not None
    assert snap["whitespace_ratio"] is not None
    assert snap["alignment_issue_count"] == 0


def test_hero_dominance_delta_from_poster_scenes():
    """Hero 42% → 68% ⇒ +26%, handed as geometry (not LLM guess)."""
    base = _load_poster()
    v1_scene = _with_hero(base, 768, 1134)  # 768*1134 / frame = 0.42
    v2_scene = _with_hero(base, 864, 1632)  # 864*1632 / frame = 0.68
    assert 768 * 1134 / _FRAME == 0.42
    assert 864 * 1632 / _FRAME == 0.68
    v1 = build_scene_visual_snapshot(
        nodes=list(v1_scene["nodes"]),
        frames=list(v1_scene["frames"]),
        focus_frame_id="frame_poster",
    )
    v2 = build_scene_visual_snapshot(
        nodes=list(v2_scene["nodes"]),
        frames=list(v2_scene["frames"]),
        focus_frame_id="frame_poster",
    )
    assert round(float(v1["hero_coverage"]), 2) == 0.42
    assert round(float(v2["hero_coverage"]), 2) == 0.68
    diff = compute_visual_diff(v1, v2)
    assert round(diff["deltas"]["hero_coverage"], 2) == 0.26
    assert diff["pixel_available"] is False
    assert (diff.get("pixel") or {}).get("status") == "unavailable"
    assert diff.get("visual_change")


def test_pixel_unavailable_without_screenshots():
    diff = compute_visual_diff(
        {"hero_coverage": 0.42, "whitespace_ratio": 0.18, "node_count": 12},
        {"hero_coverage": 0.68, "whitespace_ratio": 0.32, "node_count": 8},
    )
    assert round(diff["deltas"]["hero_coverage"], 2) == 0.26
    assert diff["pixel_available"] is False
    assert (diff.get("pixel") or {}).get("status") == "unavailable"


def test_http_preview_stays_unavailable():
    diff = compute_visual_diff(
        {"hero_coverage": 0.42},
        {"hero_coverage": 0.68},
        pixel_v1="https://example.com/v1.png",
        pixel_v2="https://example.com/v2.png",
    )
    assert diff["pixel_available"] is False
    assert (diff.get("pixel") or {}).get("status") == "unavailable"


def test_pixel_metrics_when_both_pngs_present():
    a = _png_data((20, 20, 20))
    b = _png_data((220, 220, 220))
    diff = compute_visual_diff(
        {"hero_coverage": 0.42, "node_count": 4},
        {"hero_coverage": 0.68, "node_count": 4},
        pixel_v1=a,
        pixel_v2=b,
    )
    assert diff["pixel_available"] is True
    pixel = diff["pixel"]
    assert pixel["status"] == "ok"
    assert pixel["diff"] > 0
    assert 0.0 <= pixel["ssim"] <= 1.0
    assert "perceptual" in pixel
    assert "edge" in pixel
    assert "layout" in pixel


def test_record_visual_diff_keeps_runtime_only():
    base = _load_poster()
    v1_scene = _with_hero(base, 768, 1134)
    v2_scene = _with_hero(base, 864, 1632)
    rt = _rt(nodes=v1_scene["nodes"], frames=v1_scene["frames"])
    first = record_visual_diff(rt)
    assert first is None
    assert rt.visual_snapshot["hero_coverage"]
    assert rt.visual_diff is None
    rt.scene_nodes = list(v2_scene["nodes"])
    second = record_visual_diff(rt)
    assert second is not None
    assert round(second["deltas"]["hero_coverage"], 2) == 0.26
    assert rt.scene_nodes == v2_scene["nodes"]


def test_judge_receives_hero_delta_evidence():
    rt = _rt()
    rt.visual_diff = compute_visual_diff(
        {"hero_coverage": 0.42, "whitespace_ratio": 0.18, "node_count": 12},
        {"hero_coverage": 0.68, "whitespace_ratio": 0.32, "node_count": 8},
    )
    judge = attach_judge(
        rt,
        {
            "scores": {
                "composition": 8,
                "hierarchy": 18,
                "typography": 14,
                "color": 14,
                "consistency": 13,
                "content": 9,
                "originality": 4,
            },
            "total": 12,
            "issues": [
                {
                    "severity": "major",
                    "lane": "composition",
                    "issue": "hero too small vs brief",
                    "fix_hint": "grow the relic",
                    "evidence": ["hero 42%"],
                }
            ],
            "lanes": [{"lane": "composition", "score": 8, "evidence": ["hero 42%"]}],
        },
    )
    evidence = " ".join(judge["top_issues"][0]["evidence"])
    assert "hero 42% → 68% (+26%)" in evidence
    assert "whitespace 18% → 32% (+14%)" in evidence
    assert judge["visual_diff"]["deltas"]["hero_coverage"]
    assert round(judge["visual_diff"]["deltas"]["hero_coverage"], 2) == 0.26
    assert judge["visual_diff"]["pixel_available"] is False
    assert rt.scene_nodes == []
