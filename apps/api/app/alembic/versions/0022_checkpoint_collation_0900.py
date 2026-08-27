"""Align LangGraph checkpoint tables with MySQL 8 / JSON_TABLE default collation.

LangGraph ``JSON_TABLE(... VARCHAR ... CHARACTER SET utf8mb4)`` resolves to
``utf8mb4_0900_ai_ci`` on MySQL 8. Tables created under
``utf8mb4_unicode_ci`` then fail JOINs with Illegal mix of collations (1267).

Revision ID: 0022_checkpoint_collation_0900
Revises: 0021_design_task_meta_json_longtext
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0022_checkpoint_collation_0900"
down_revision = "0021_design_task_meta_json_longtext"
branch_labels = None
depends_on = None

_TABLES = (
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
    "checkpoint_migrations",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    for name in _TABLES:
        if name not in existing:
            continue
        op.execute(
            sa.text(
                f"ALTER TABLE `{name}` CONVERT TO CHARACTER SET utf8mb4 "
                "COLLATE utf8mb4_0900_ai_ci"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    for name in _TABLES:
        if name not in existing:
            continue
        op.execute(
            sa.text(
                f"ALTER TABLE `{name}` CONVERT TO CHARACTER SET utf8mb4 "
                "COLLATE utf8mb4_unicode_ci"
            )
        )
