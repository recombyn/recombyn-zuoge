"""Widen agent snapshot + design_task text columns (VARCHAR(255) → LONGTEXT).

``task_state_json`` holds medium-term agent memory JSON and exceeds 255 chars
after a few turns. Writing that failure into ``error_message`` then overflows
VARCHAR(255) again and surfaces a nested DataError toast. ``prompt`` /
``result_svg`` have the same AutoString → VARCHAR(255) trap.

Revision ID: 0023_widen_agent_task_text
Revises: 0022_checkpoint_collation_0900
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0023_widen_agent_task_text"
down_revision = "0022_checkpoint_collation_0900"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "agent_session_snapshot" in tables:
        op.execute(
            sa.text(
                "ALTER TABLE agent_session_snapshot MODIFY task_state_json LONGTEXT NOT NULL"
            )
        )
    if "design_task" in tables:
        op.execute(
            sa.text("ALTER TABLE design_task MODIFY error_message LONGTEXT NULL")
        )
        op.execute(sa.text("ALTER TABLE design_task MODIFY prompt LONGTEXT NULL"))
        op.execute(sa.text("ALTER TABLE design_task MODIFY result_svg LONGTEXT NULL"))


def downgrade() -> None:
    # Do not shrink LONGTEXT — would truncate production data.
    pass
