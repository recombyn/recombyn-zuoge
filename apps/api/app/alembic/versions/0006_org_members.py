"""Add orgs + org_members for multi-tenant RBAC skeleton.

Revision ID: 0006_org_members
Revises: 0005_drop_design_library
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0006_org_members"
down_revision = "0005_drop_design_library"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "orgs" not in tables:
        op.create_table(
            "orgs",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("name", sa.String(120), nullable=False, server_default="Untitled org"),
            sa.Column("created_at", sa.Float(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.Float(), nullable=False, server_default="0"),
        )
    if "org_members" not in tables:
        op.create_table(
            "org_members",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("org_id", sa.String(64), nullable=False),
            sa.Column("user_id", sa.String(64), nullable=False),
            sa.Column("role", sa.String(16), nullable=False, server_default="member"),
            sa.Column("created_at", sa.Float(), nullable=False, server_default="0"),
            sa.UniqueConstraint("org_id", "user_id", name="uq_org_members_org_user"),
        )
        op.create_index("ix_org_members_org_id", "org_members", ["org_id"])
        op.create_index("ix_org_members_user_id", "org_members", ["user_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    tables = set(insp.get_table_names())
    if "org_members" in tables:
        op.drop_table("org_members")
    if "orgs" in tables:
        op.drop_table("orgs")
