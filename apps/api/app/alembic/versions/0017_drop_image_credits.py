"""Drop unused user_balances.image_credits.

Revision ID: 0017_drop_image_credits
Revises: 0016_design_task_outboxes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017_drop_image_credits"
down_revision = "0016_design_task_outboxes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "user_balances" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("user_balances")}
    if "image_credits" in cols:
        op.drop_column("user_balances", "image_credits")


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "user_balances" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("user_balances")}
    if "image_credits" not in cols:
        op.add_column(
            "user_balances",
            sa.Column(
                "image_credits",
                sa.Integer(),
                nullable=False,
                server_default="0",
            ),
        )
