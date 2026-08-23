"""Add nullable projects.org_id for team projects.

Revision ID: 0007_project_org_id
Revises: 0006_org_members
Create Date: 2026-08-12
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007_project_org_id"
down_revision = "0006_org_members"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    cols = {c["name"] for c in insp.get_columns("projects")} if "projects" in insp.get_table_names() else set()
    if "org_id" not in cols:
        op.add_column("projects", sa.Column("org_id", sa.String(64), nullable=True))
        op.create_index("ix_projects_org_id", "projects", ["org_id"])


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "projects" not in insp.get_table_names():
        return
    cols = {c["name"] for c in insp.get_columns("projects")}
    if "org_id" in cols:
        op.drop_index("ix_projects_org_id", table_name="projects")
        op.drop_column("projects", "org_id")
