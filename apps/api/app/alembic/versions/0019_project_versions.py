"""Add project_versions for named / auto cloud history.

Revision ID: 0019_project_versions
Revises: 0018_rename_wallet_tokens_to_credits
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019_project_versions"
down_revision = "0018_rename_wallet_tokens_to_credits"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "project_versions" in insp.get_table_names():
        return
    op.create_table(
        "project_versions",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("project_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("user_id", sa.String(length=64), nullable=False, index=True),
        sa.Column("name", sa.String(length=255), nullable=False, server_default=""),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=16), nullable=False, server_default="named", index=True),
        sa.Column("source_revision", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("document_key", sa.String(length=512), nullable=True),
        sa.Column("document_json", sa.Text(), nullable=True),
        sa.Column("thumbnail_key", sa.Text(), nullable=True),
        sa.Column("created_at", sa.Float(), nullable=False, server_default="0", index=True),
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "project_versions" not in insp.get_table_names():
        return
    op.drop_table("project_versions")
