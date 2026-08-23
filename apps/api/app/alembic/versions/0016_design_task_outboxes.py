"""Move design run replay outboxes out of design_task.meta_json.

Revision ID: 0016_design_task_outboxes
Revises: 0015_pricing_versions
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0016_design_task_outboxes"
down_revision = "0015_pricing_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    if "design_task_event" not in tables:
        op.create_table(
            "design_task_event",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.String(64), nullable=False),
            sa.Column("event_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.Float(), nullable=False),
        )
        op.create_index("ix_design_task_event_task_id", "design_task_event", ["task_id"])
    if "design_task_canvas_command" not in tables:
        op.create_table(
            "design_task_canvas_command",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("task_id", sa.String(64), nullable=False),
            sa.Column("command_json", sa.Text(), nullable=False),
            sa.Column("created_at", sa.Float(), nullable=False),
            sa.Column("acknowledged_at", sa.Float(), nullable=True),
        )
        op.create_index("ix_design_task_canvas_command_task_id", "design_task_canvas_command", ["task_id"])


def downgrade() -> None:
    tables = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("design_task_canvas_command", "design_task_event"):
        if table in tables:
            op.drop_table(table)
