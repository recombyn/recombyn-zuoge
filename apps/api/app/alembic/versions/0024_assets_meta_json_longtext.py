"""Widen assets.meta_json (MySQL VARCHAR(255) → LONGTEXT).

Lottie generation stores full animationData inline for asset-list preview;
payloads routinely exceed 255 chars and fail with DataError 1406.

Revision ID: 0024_assets_meta_json_longtext
Revises: 0023_widen_agent_task_text
Create Date: 2026-08-27
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024_assets_meta_json_longtext"
down_revision = "0023_widen_agent_task_text"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    if "assets" not in insp.get_table_names():
        return
    op.execute(sa.text("ALTER TABLE assets MODIFY meta_json LONGTEXT NULL"))


def downgrade() -> None:
    # Do not shrink LONGTEXT — would truncate production lottie metadata.
    pass
