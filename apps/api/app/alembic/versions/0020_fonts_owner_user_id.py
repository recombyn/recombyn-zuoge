"""Add fonts.owner_user_id for per-user uploads.

Revision ID: 0020_fonts_owner_user_id
Revises: 0019_project_versions
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0020_fonts_owner_user_id"
down_revision = "0019_project_versions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "fonts" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("fonts")}
    if "owner_user_id" in cols:
        return
    op.add_column("fonts", sa.Column("owner_user_id", sa.String(length=64), nullable=True))
    op.create_index("ix_fonts_owner_user_id", "fonts", ["owner_user_id"], unique=False)


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "fonts" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("fonts")}
    if "owner_user_id" not in cols:
        return
    op.drop_index("ix_fonts_owner_user_id", table_name="fonts")
    op.drop_column("fonts", "owner_user_id")
