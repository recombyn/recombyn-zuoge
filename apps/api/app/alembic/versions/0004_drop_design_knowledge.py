"""Drop design_knowledge table.

Revision ID: 0004_drop_design_knowledge
Revises: 0003_drop_aesthetics
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0004_drop_design_knowledge"
down_revision = "0003_drop_aesthetics"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "design_knowledge" in insp.get_table_names():
        op.drop_table("design_knowledge")


def downgrade() -> None:
    pass
