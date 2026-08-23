"""Design run decision / trace — maps to precheck → orchestrator layers (eval + ops)."""

from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class DesignRunDecision:
    """Single run trace; emitted as SSE type=decision and embedded in result.decision_log."""

    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    # Layer ② precheck
    route: str | None = None  # chat | blank | pipeline | blocked | error
    fast_path: bool = False
    is_chitchat: bool = False
    wants_pipeline: bool | None = None
    blank_artboard_only: bool | None = None
    has_target_chip: bool = False
    has_ref_images: bool = False
    has_scene_nodes: bool = False
    probe_len: int = 0
    # Layer ③ orchestrator + memory
    session_id: str | None = None
    focus_frame_id: str | None = None
    memory_injected: bool = False
    memory_blocks_chars: int = 0
    short_turns: int = 0
    content_pack_version: str | None = None
    # Layer ③ outcome (updated through run)
    intent: str | None = None  # chat | canvas_op | design
    paint_lane: str | None = None  # create | edit (when canvas work)
    edit_in_place: bool | None = None
    blank_artboard: bool | None = None
    tool_ops_applied: bool | None = None
    task_id: str | None = None
    scene: str | None = None

    def apply(self, **kwargs: Any) -> DesignRunDecision:
        for key, val in kwargs.items():
            if hasattr(self, key):
                setattr(self, key, val)
        return self

    def to_event(self) -> dict[str, Any]:
        raw = asdict(self)
        payload = {k: v for k, v in raw.items() if v is not None and v is not False}
        for key in (
            "edit_in_place",
            "blank_artboard",
            "wants_pipeline",
            "blank_artboard_only",
            "is_chitchat",
            "memory_injected",
            "has_target_chip",
            "has_scene_nodes",
            "has_ref_images",
            "fast_path",
        ):
            val = getattr(self, key, None)
            if val is not None:
                payload[key] = val
        return {"type": "decision", **payload}

    def to_log(self) -> dict[str, Any]:
        """Full snapshot for result.decision_log (includes falsy flags)."""
        return asdict(self)


def focus_frame_from_medium(medium: dict[str, Any] | None) -> str | None:
    if not isinstance(medium, dict):
        return None
    canvas = medium.get("canvas")
    if not isinstance(canvas, dict):
        return None
    for key in ("focus_frame_id", "last_agent_frame_id"):
        fid = canvas.get(key)
        if fid:
            return str(fid)
    return None


def probe_has_target_chip(prompt: str) -> bool:
    import re

    return bool(re.search(r"\[Target (element|group|elements|artboard)", prompt or "", flags=re.I))


def probe_has_node_target(prompt: str) -> bool:
    """True when user @-mentioned specific node(s), not the whole artboard."""
    import re

    return bool(re.search(r"\[Target (element|group|elements)\b", prompt or "", flags=re.I))
