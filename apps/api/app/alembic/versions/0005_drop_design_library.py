"""Drop design_library_item table.

Revision ID: 0005_drop_design_library
Revises: 0004_drop_design_knowledge
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0005_drop_design_library"
down_revision = "0004_drop_design_knowledge"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "design_library_item" in insp.get_table_names():
        op.drop_table("design_library_item")


def downgrade() -> None:
    pass
