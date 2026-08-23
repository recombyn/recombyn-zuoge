"""Widen projects.thumbnail_key — collage stores ≤4 image URLs as JSON.

Revision ID: 0011_project_thumbnail_key_text
Revises: 0010_email_code_double
Create Date: 2026-08-13
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011_project_thumbnail_key_text"
down_revision = "0010_email_code_double"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "mysql":
        return
    insp = sa.inspect(bind)
    if "projects" not in set(insp.get_table_names()):
        return
    op.execute(sa.text("ALTER TABLE projects MODIFY thumbnail_key TEXT NULL"))


def downgrade() -> None:
    # Do not shrink TEXT back to VARCHAR — would truncate production covers.
    pass
