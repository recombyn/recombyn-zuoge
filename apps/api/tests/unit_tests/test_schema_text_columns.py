# -*- coding: utf-8 -*-
"""Guardrails: growing JSON / error text must not ship as MySQL VARCHAR(255)."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest
from sqlalchemy import Text, inspect
from sqlmodel import Session, SQLModel, create_engine

from app.models import AgentSessionSnapshot, DesignTask


# Columns that hold growing JSON / exception / SVG / long prompts.
# Bare ``str`` → AutoString → MySQL VARCHAR(255).
_REQUIRED_TEXT_COLUMNS: dict[type[SQLModel], tuple[str, ...]] = {
    DesignTask: ("meta_json", "error_message", "prompt", "result_svg"),
    AgentSessionSnapshot: ("task_state_json",),
}


def _column_is_unbounded_text(col) -> bool:
    """True only for explicit Text / LONGTEXT (not AutoString → MySQL VARCHAR(255))."""
    return isinstance(col.type, Text)


@pytest.mark.parametrize(
    ("model", "column"),
    [(m, c) for m, cols in _REQUIRED_TEXT_COLUMNS.items() for c in cols],
)
def test_growing_payload_columns_use_text_not_varchar255(model: type[SQLModel], column: str):
    cols = {c.name: c for c in inspect(model).columns}
    assert column in cols, f"{model.__tablename__}.{column} missing"
    col = cols[column]
    assert _column_is_unbounded_text(col), (
        f"{model.__tablename__}.{column} is {col.type!r} — use Field(..., sa_column=Column(Text)) "
        "so MySQL does not create VARCHAR(255) (Data too long / nested error_message overflow)"
    )


def test_agent_session_snapshot_accepts_payload_over_255_chars(tmp_path: Path):
    from app.crud import upsert_agent_session_snapshot

    engine = create_engine(f"sqlite:///{(tmp_path / 'snap.db').as_posix()}")
    SQLModel.metadata.create_all(engine, tables=[AgentSessionSnapshot.__table__])
    big = json.dumps(
        {
            "short_turns": [
                {"kind": "goal", "text": f"User request:\\n{'你好' * 40}"}
                for _ in range(8)
            ],
            "updated_at": time.time(),
        },
        ensure_ascii=False,
    )
    assert len(big) > 255
    with Session(engine) as session:
        row = upsert_agent_session_snapshot(
            session=session,
            session_id="sess-wide",
            user_id="u1",
            project_id="p1",
            task_state_json=big,
            updated_at=time.time(),
            created_at=time.time(),
        )
        assert row.task_state_json == big
        again = session.get(AgentSessionSnapshot, "sess-wide")
        assert again is not None
        assert len(again.task_state_json) == len(big)


def test_migration_0023_widen_agent_task_text_exists():
    root = Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    path = root / "0023_widen_agent_task_text.py"
    assert path.is_file()
    text = path.read_text(encoding="utf-8")
    assert "task_state_json" in text
    assert "error_message" in text
    assert "prompt" in text
    assert "result_svg" in text
    assert "LONGTEXT" in text
    assert "0022_checkpoint_collation_0900" in text


def test_migration_0022_checkpoint_collation_exists():
    root = Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    path = root / "0022_checkpoint_collation_0900.py"
    assert path.is_file()
    text = path.read_text(encoding="utf-8")
    for table in (
        "checkpoints",
        "checkpoint_blobs",
        "checkpoint_writes",
        "checkpoint_migrations",
    ):
        assert table in text
    assert "utf8mb4_0900_ai_ci" in text
