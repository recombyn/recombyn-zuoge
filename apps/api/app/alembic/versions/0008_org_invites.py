"""Add org_invites for pending team invitations.

Revision ID: 0008_org_invites
Revises: 0007_project_org_id
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0008_org_invites"
down_revision = "0007_project_org_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "org_invites" in insp.get_table_names():
        return
    op.create_table(
        "org_invites",
        sa.Column("id", sa.String(64), primary_key=True),
        sa.Column("org_id", sa.String(64), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("user_id", sa.String(64), nullable=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="member"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("invited_by", sa.String(64), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False, server_default="0"),
        sa.Column("responded_at", sa.Float(), nullable=True),
    )
    op.create_index("ix_org_invites_org_id", "org_invites", ["org_id"])
    op.create_index("ix_org_invites_user_id", "org_invites", ["user_id"])
    op.create_index("ix_org_invites_email", "org_invites", ["email"])
    op.create_index("ix_org_invites_status", "org_invites", ["status"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "org_invites" not in insp.get_table_names():
        return
    op.drop_index("ix_org_invites_status", table_name="org_invites")
    op.drop_index("ix_org_invites_email", table_name="org_invites")
    op.drop_index("ix_org_invites_user_id", table_name="org_invites")
    op.drop_index("ix_org_invites_org_id", table_name="org_invites")
    op.drop_table("org_invites")
