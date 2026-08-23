"""DesignTransaction — one AI canvas mutation unit (undo / ACK / conflict)."""

from __future__ import annotations

import uuid
from typing import Any, Literal

from pydantic import BaseModel

DesignTransactionPhase = Literal[
    "composition",
    "paint",
    "correction",
    "polish",
    "final",
]


class DesignTransaction(BaseModel):
    """One AI canvas mutation unit (undo / ACK / conflict scope).

    Lifecycle: BEGIN → VALIDATE → APPLY (chunks) → COMMIT → ACK
    Failure: ROLLBACK (FE undoes the history group; Host clears active tx).
    """

    transaction_id: str
    turn_id: str = ""
    design_id: str = ""
    phase: DesignTransactionPhase = "paint"
    intent: str = ""
    base_revision: int = 0
    ops_count: int = 0
    expected: dict[str, Any] | None = None

    model_config = {"extra": "allow"}


def new_design_transaction(
    *,
    task_id: str,
    turn_id: str = "",
    phase: DesignTransactionPhase = "paint",
    intent: str = "",
    base_revision: int = 0,
    ops_count: int = 0,
    expected: dict[str, Any] | None = None,
) -> DesignTransaction:
    tid = f"tx_{uuid.uuid4().hex[:16]}"
    return DesignTransaction(
        transaction_id=tid,
        turn_id=str(turn_id or ""),
        design_id=str(task_id or ""),
        phase=phase,
        intent=str(intent or ""),
        base_revision=max(0, int(base_revision or 0)),
        ops_count=max(0, int(ops_count or 0)),
        expected=expected if isinstance(expected, dict) else None,
    )


def resolve_transaction_phase(rt: Any) -> DesignTransactionPhase:
    """Map runtime flags → transaction phase (paint / correction / polish)."""
    flags = getattr(rt, "flags", None)
    flags = flags if isinstance(flags, dict) else {}
    if flags.get("polish"):
        return "polish"
    action = str(flags.get("review_action") or "").strip().lower()
    if action == "rebuild":
        return "paint"
    if action == "repair" or flags.get("review_failed") or flags.get("critique_failed"):
        return "correction"
    return "paint"
