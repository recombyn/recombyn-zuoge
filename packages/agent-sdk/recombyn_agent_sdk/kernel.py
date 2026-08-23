"""Design Agent Kernel stage vocabulary (open).

Kernel loop (canonical):
  intent → decide → paint → observe → review → settle

Review / Judge / Diff / Simulation / Counterfactual / Governance must not
mutate the canvas; only paint (and host apply) may emit tool_ops.
"""

from __future__ import annotations

# Full Kernel stages (logical product loop).
KERNEL_STAGES: tuple[str, ...] = (
    "intent",
    "decide",
    "paint",
    "observe",
    "review",
    "settle",
)

# Minimum stages for canvas_ops_v1 topology (live LangGraph).
KERNEL_CANVAS_REQUIRED: tuple[str, ...] = (
    "intent",
    "decide",
    "paint",
    "observe",
)

# Default AgentProfile contracts map (stage → schema id).
DEFAULT_CONTRACT_IDS: dict[str, str] = {
    "intent": "IntentTurn.v1",
    "decide": "DecideTurn.v1",
    "act": "ToolOpsBatch.v1",
    "paint": "ToolOpsBatch.v1",
    "review": "ReviewTurn.v1",
}

PROFILE_KIND = "AgentProfile"

# Stages that may produce canvas mutations (tool_ops). Others are read/gate only.
_PAINT_MUTATING = frozenset({"paint", "act"})


def is_kernel_stage(name: str) -> bool:
    return str(name or "").strip().lower() in KERNEL_STAGES


def is_paint_mutating_stage(name: str) -> bool:
    """True only for stages allowed to emit SceneDocument tool_ops."""
    return str(name or "").strip().lower() in _PAINT_MUTATING
