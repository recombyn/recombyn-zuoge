"""Widen design_task.meta_json (MySQL VARCHAR(255) → LONGTEXT).

Revision ID: 0021_design_task_meta_json_longtext
Revises: 0020_fonts_owner_user_id
Create Date: 2026-08-26
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021_design_task_meta_json_longtext"
down_revision = "0020_fonts_owner_user_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    if "design_task" not in insp.get_table_names():
        return
    op.execute(sa.text("ALTER TABLE design_task MODIFY meta_json LONGTEXT NULL"))


def downgrade() -> None:
    # Do not shrink LONGTEXT back to VARCHAR — would truncate production data.
    pass
